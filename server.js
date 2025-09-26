const express = require('express');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const { Storage } = require('@google-cloud/storage');
const app = express();
const PORT = process.env.PORT || 3000;

// GCS Setup
const bucketName = process.env.BUCKET_NAME;
console.log('Environment variables:');
console.log('- BUCKET_NAME:', bucketName || 'NOT SET');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'NOT SET');

let storage = null;
let bucket = null;

if (bucketName) {
  try {
    storage = new Storage();
    bucket = storage.bucket(bucketName);
    console.log('GCS Storage initialized successfully for bucket:', bucketName);
  } catch (error) {
    console.error('Failed to initialize GCS Storage:', error);
  }
} else {
  console.log('BUCKET_NAME not configured, photo uploads will be disabled');
}

// Multer setup for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/jpeg') {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG files are allowed'), false);
    }
  }
});

// In-memory storage for todos
let todos = [
  { id: 1, text: 'Welcome to your todo app!', completed: false, hasPhoto: false, photoFilename: null },
  { id: 2, text: 'Add your first todo', completed: false, hasPhoto: false, photoFilename: null }
];
let nextId = 3;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error('Multer error:', error);
    return res.status(400).json({ error: error.message });
  } else if (error) {
    console.error('General error:', error);
    return res.status(500).json({ error: error.message });
  }
  next();
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    todos: todos.length,
    environment: {
      bucketName: bucketName || 'NOT SET',
      bucketConfigured: !!bucket,
      nodeEnv: process.env.NODE_ENV || 'NOT SET'
    }
  });
});

// Todo API endpoints
app.get('/api/todos', (req, res) => {
  res.json(todos);
});

// Helper function to upload photo to GCS
async function uploadPhotoToGCS(buffer, todoId) {
  if (!bucket) {
    throw new Error('GCS bucket not configured');
  }
  
  // Optimize image with Sharp
  const optimizedBuffer = await sharp(buffer)
    .jpeg({ quality: 85, progressive: true })
    .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
    .toBuffer();
  
  const filename = `todos/${todoId}/${Date.now()}.jpg`;
  const file = bucket.file(filename);
  
  await file.save(optimizedBuffer, {
    metadata: {
      contentType: 'image/jpeg',
    }
  });
  
  return filename;
}

// Helper function to generate signed URL
async function getSignedUrl(filename) {
  if (!bucket || !filename) return null;
  
  const file = bucket.file(filename);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
  });
  
  return url;
}

app.post('/api/todos', upload.single('photo'), async (req, res) => {
  console.log('POST /api/todos - Body:', req.body);
  console.log('POST /api/todos - File:', req.file ? 'Present' : 'Not present');
  console.log('POST /api/todos - Bucket configured:', !!bucket);
  
  const { text } = req.body;
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'Todo text is required' });
  }
  
  const newTodo = {
    id: nextId++,
    text: text.trim(),
    completed: false,
    hasPhoto: false,
    photoFilename: null
  };
  
  // Handle photo upload if present
  if (req.file && bucket) {
    console.log('Attempting to upload photo for todo', newTodo.id);
    try {
      const filename = await uploadPhotoToGCS(req.file.buffer, newTodo.id);
      console.log('Photo uploaded successfully:', filename);
      newTodo.hasPhoto = true;
      newTodo.photoFilename = filename;
    } catch (error) {
      console.error('Photo upload failed:', error);
      // Continue without photo
    }
  } else if (req.file && !bucket) {
    console.log('Photo uploaded but bucket not configured');
  } else {
    console.log('No photo in request or bucket not configured');
  }
  
  todos.push(newTodo);
  console.log('Todo created:', newTodo);
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

app.delete('/api/todos/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const todoIndex = todos.findIndex(t => t.id === id);
  
  if (todoIndex === -1) {
    return res.status(404).json({ error: 'Todo not found' });
  }
  
  const todo = todos[todoIndex];
  
  // Delete photo from GCS if it exists
  if (todo.hasPhoto && todo.photoFilename && bucket) {
    try {
      await bucket.file(todo.photoFilename).delete();
    } catch (error) {
      console.error('Failed to delete photo from GCS:', error);
      // Continue with todo deletion
    }
  }
  
  todos.splice(todoIndex, 1);
  res.status(204).send();
});

// Get photo URL for a todo
app.get('/api/todos/:id/photo', async (req, res) => {
  const id = parseInt(req.params.id);
  const todo = todos.find(t => t.id === id);
  
  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }
  
  if (!todo.hasPhoto || !todo.photoFilename) {
    return res.status(404).json({ error: 'No photo attached to this todo' });
  }
  
  try {
    const signedUrl = await getSignedUrl(todo.photoFilename);
    if (!signedUrl) {
      return res.status(500).json({ error: 'Failed to generate photo URL' });
    }
    
    res.json({ photoUrl: signedUrl });
  } catch (error) {
    console.error('Failed to get signed URL:', error);
    res.status(500).json({ error: 'Failed to retrieve photo' });
  }
});

// Add photo to existing todo
app.post('/api/todos/:id/photo', upload.single('photo'), async (req, res) => {
  const id = parseInt(req.params.id);
  const todo = todos.find(t => t.id === id);
  
  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: 'No photo uploaded' });
  }
  
  if (!bucket) {
    return res.status(500).json({ error: 'Photo storage not configured' });
  }
  
  try {
    // Delete existing photo if present
    if (todo.hasPhoto && todo.photoFilename) {
      try {
        await bucket.file(todo.photoFilename).delete();
      } catch (error) {
        console.error('Failed to delete existing photo:', error);
      }
    }
    
    const filename = await uploadPhotoToGCS(req.file.buffer, id);
    todo.hasPhoto = true;
    todo.photoFilename = filename;
    
    res.json(todo);
  } catch (error) {
    console.error('Photo upload failed:', error);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// Delete photo from todo
app.delete('/api/todos/:id/photo', async (req, res) => {
  const id = parseInt(req.params.id);
  const todo = todos.find(t => t.id === id);
  
  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }
  
  if (!todo.hasPhoto || !todo.photoFilename) {
    return res.status(404).json({ error: 'No photo attached to this todo' });
  }
  
  try {
    if (bucket) {
      await bucket.file(todo.photoFilename).delete();
    }
    
    todo.hasPhoto = false;
    todo.photoFilename = null;
    
    res.json(todo);
  } catch (error) {
    console.error('Failed to delete photo:', error);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Todo app running on port ${PORT}`);
  console.log(`📱 Access your app at http://localhost:${PORT}`);
});