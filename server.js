const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { forms: [], responses: [], events: [] }; }
}
function writeStore(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DATA_FILE);
}
function id(size = 8) { return crypto.randomBytes(size).toString('hex'); }
function cleanForm(input, previous = {}) {
  const allowed = new Set(['text', 'email', 'tel', 'textarea', 'select', 'radio', 'checkbox']);
  return {
    ...previous,
    title: String(input.title || '').trim().slice(0, 120),
    description: String(input.description || '').trim().slice(0, 800),
    buttonText: String(input.buttonText || 'Отправить отклик').trim().slice(0, 40),
    successMessage: String(input.successMessage || 'Спасибо! Ваш отклик отправлен.').trim().slice(0, 200),
    fields: Array.isArray(input.fields) ? input.fields.slice(0, 30).map((f) => ({
      id: String(f.id || id(4)),
      type: allowed.has(f.type) ? f.type : 'text',
      label: String(f.label || '').trim().slice(0, 120),
      placeholder: String(f.placeholder || '').trim().slice(0, 120),
      required: Boolean(f.required),
      options: Array.isArray(f.options) ? f.options.map(String).map(x => x.trim()).filter(Boolean).slice(0, 20) : []
    })).filter(f => f.label) : []
  };
}
function publicForm(form) {
  const { id, slug, title, description, buttonText, successMessage, fields, published, createdAt, updatedAt } = form;
  return { id, slug, title, description, buttonText, successMessage, fields, published, createdAt, updatedAt };
}
function validateAnswers(form, answers) {
  const errors = {};
  for (const field of form.fields) {
    const value = answers?.[field.id];
    const empty = Array.isArray(value) ? value.length === 0 : !String(value ?? '').trim();
    if (field.required && empty) errors[field.id] = 'Обязательное поле';
    if (!empty && field.type === 'email' && !/^\S+@\S+\.\S+$/.test(String(value))) errors[field.id] = 'Укажите корректный email';
  }
  return errors;
}

app.get('/api/forms', (req, res) => {
  const s = readStore();
  res.json(s.forms.map(f => ({ ...publicForm(f), responses: s.responses.filter(r => r.formId === f.id).length,
    views: s.events.filter(e => e.formId === f.id && e.type === 'view').length,
    starts: s.events.filter(e => e.formId === f.id && e.type === 'start').length })));
});
app.post('/api/forms', (req, res) => {
  const s = readStore(); const now = new Date().toISOString();
  const form = cleanForm(req.body);
  if (!form.title) return res.status(400).json({ error: 'Введите название формы' });
  Object.assign(form, { id: id(), slug: id(5), published: false, createdAt: now, updatedAt: now });
  s.forms.unshift(form); writeStore(s); res.status(201).json(publicForm(form));
});
app.put('/api/forms/:id', (req, res) => {
  const s = readStore(); const i = s.forms.findIndex(f => f.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Форма не найдена' });
  const next = cleanForm(req.body, s.forms[i]);
  if (!next.title) return res.status(400).json({ error: 'Введите название формы' });
  next.updatedAt = new Date().toISOString(); s.forms[i] = next; writeStore(s); res.json(publicForm(next));
});
app.patch('/api/forms/:id/publish', (req, res) => {
  const s = readStore(); const form = s.forms.find(f => f.id === req.params.id);
  if (!form) return res.status(404).json({ error: 'Форма не найдена' });
  if (!form.fields.length && req.body.published) return res.status(400).json({ error: 'Добавьте хотя бы одно поле' });
  form.published = Boolean(req.body.published); form.updatedAt = new Date().toISOString(); writeStore(s); res.json(publicForm(form));
});
app.delete('/api/forms/:id', (req, res) => {
  const s = readStore(); const before = s.forms.length;
  s.forms = s.forms.filter(f => f.id !== req.params.id);
  if (s.forms.length === before) return res.status(404).json({ error: 'Форма не найдена' });
  s.responses = s.responses.filter(r => r.formId !== req.params.id); s.events = s.events.filter(e => e.formId !== req.params.id);
  writeStore(s); res.status(204).end();
});
app.get('/api/forms/:id/responses', (req, res) => {
  const s = readStore(); const form = s.forms.find(f => f.id === req.params.id);
  if (!form) return res.status(404).json({ error: 'Форма не найдена' });
  res.json({ form: publicForm(form), responses: s.responses.filter(r => r.formId === form.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
});
app.get('/api/public/:slug', (req, res) => {
  const s = readStore(); const form = s.forms.find(f => f.slug === req.params.slug && f.published);
  if (!form) return res.status(404).json({ error: 'Форма не найдена или ещё не опубликована' });
  res.json(publicForm(form));
});
app.post('/api/public/:slug/event', (req, res) => {
  const s = readStore(); const form = s.forms.find(f => f.slug === req.params.slug && f.published);
  if (!form) return res.status(404).end();
  if (!['view', 'start'].includes(req.body.type)) return res.status(400).end();
  s.events.push({ id: id(6), formId: form.id, type: req.body.type, sessionId: String(req.body.sessionId || '').slice(0, 80), createdAt: new Date().toISOString() });
  writeStore(s); res.status(204).end();
});
app.post('/api/public/:slug/responses', (req, res) => {
  const s = readStore(); const form = s.forms.find(f => f.slug === req.params.slug && f.published);
  if (!form) return res.status(404).json({ error: 'Форма не найдена' });
  const errors = validateAnswers(form, req.body.answers);
  if (Object.keys(errors).length) return res.status(422).json({ error: 'Проверьте заполнение', errors });
  const answers = {};
  for (const field of form.fields) if (req.body.answers?.[field.id] !== undefined) answers[field.id] = req.body.answers[field.id];
  s.responses.push({ id: id(), formId: form.id, answers, createdAt: new Date().toISOString() }); writeStore(s);
  res.status(201).json({ successMessage: form.successMessage });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/f/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'form.html')));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));
app.listen(PORT, () => console.log(`Forma запущена: http://localhost:${PORT}`));
