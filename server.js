const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage for todos
let todos = [
  { id: 1, text: 'Welcome to your todo app!', completed: false },
  { id: 2, text: 'Add your first todo', completed: false }
];
let nextId = 3;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    todos: todos.length
  });
});

// Todo API endpoints
app.get('/api/todos', (req, res) => {
  res.json(todos);
});

app.post('/api/todos', (req, res) => {
  const { text } = req.body;
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'Todo text is required' });
  }
  
  const newTodo = {
    id: nextId++,
    text: text.trim(),
    completed: false
  };
  
  todos.push(newTodo);
  res.status(201).json(newTodo);
});

app.put('/api/todos/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { completed } = req.body;
  
  const todo = todos.find(t => t.id === id);
  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }
  
  if (typeof completed === 'boolean') {
    todo.completed = completed;
  }
  
  res.json(todo);
});

app.delete('/api/todos/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const todoIndex = todos.findIndex(t => t.id === id);
  
  if (todoIndex === -1) {
    return res.status(404).json({ error: 'Todo not found' });
  }
  
  todos.splice(todoIndex, 1);
  res.status(204).send();
});

app.listen(PORT, () => {
  console.log(`🚀 Todo app running on port ${PORT}`);
  console.log(`📱 Access your app at http://localhost:${PORT}`);
});