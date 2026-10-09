const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const db = require('./database');

// Azure Blob Storage SDK
let BlobServiceClient;
try {
  ({ BlobServiceClient } = require('@azure/storage-blob'));
} catch (err) {
  console.warn('Azure Blob Storage SDK not yet loaded:', err.message);
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'azure-cloud-csa302-secret-key-2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for in-memory file uploads (directly streamed to Azure Blob)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max limit
  fileFilter: (req, file, cb) => {
    const allowedExtensions = /pdf|docx?|pptx?|txt|zip|png|jpe?g/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (allowedExtensions.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type .${ext} is not allowed. Upload PDF, DOCX, PPTX, TXT, ZIP, or Images.`));
    }
  }
});

// Storage Configuration
const AZURE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'study-notes';
const LOCAL_UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(LOCAL_UPLOADS_DIR)) fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });

let blobServiceClient = null;
let containerClient = null;
let isAzureConnected = false;

// Initialize Azure Blob Client
async function initAzureStorage() {
  if (!AZURE_CONNECTION_STRING || AZURE_CONNECTION_STRING.includes('YOUR_AZURE_STORAGE_CONNECTION_STRING')) {
    console.log('ℹ️ Azure Storage Connection String not configured. Operating in LOCAL FALLBACK mode.');
    return;
  }

  try {
    if (!BlobServiceClient) {
      console.warn('Azure SDK not installed or failed to import.');
      return;
    }
    blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING);
    containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    // Create container if it does not exist
    await containerClient.createIfNotExists({
      access: 'blob'
    });
    isAzureConnected = true;
    db.setCloudContainerClient(containerClient);
    console.log(`✅ Connected to Azure Blob Storage container: "${CONTAINER_NAME}"`);
  } catch (err) {
    console.error('⚠️ Failed to connect to Azure Blob Storage:', err.message);
    console.log('Falling back to local file storage.');
    isAzureConnected = false;
  }
}

// -----------------------------------------------------------------------------
// AUTHENTICATION MIDDLEWARE
// -----------------------------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      req.user = null;
    } else {
      req.user = user;
    }
    next();
  });
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. Please log in to perform this action.'
    });
  }
  next();
}

app.use(authenticateToken);

// -----------------------------------------------------------------------------
// USER AUTHENTICATION ROUTES (REGISTER & LOGIN)
// -----------------------------------------------------------------------------

// 1. User Registration -> Stored in Database
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, rollNumber, semester } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    // Check if user already exists
    const existing = await db.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Hash password securely with bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = {
      id: uuidv4(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      rollNumber: (rollNumber || '').trim(),
      semester: semester || 'General',
      createdAt: new Date().toISOString()
    };

    await db.createUser(newUser);

    // Issue JWT Token
    const token = jwt.sign(
      { id: newUser.id, name: newUser.name, email: newUser.email, semester: newUser.semester },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful! Welcome to the portal.',
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        rollNumber: newUser.rollNumber,
        semester: newUser.semester
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Error registering user' });
  }
});

// 2. User Login -> Validated from Database
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password.' });
    }

    const user = await db.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Issue JWT Token
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, semester: user.semester },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        rollNumber: user.rollNumber,
        semester: user.semester
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Error logging in' });
  }
});

// 3. Current User Profile
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// -----------------------------------------------------------------------------
// STUDY NOTES REST API ROUTES (CRUD)
// -----------------------------------------------------------------------------

// System Status
app.get('/api/status', (req, res) => {
  res.json({
    project: 'Study Notes Sharing Portal (Group 7)',
    course: 'CSA-302: Cloud Computing Practical Assignment',
    storageMode: isAzureConnected ? 'Azure Blob Storage' : 'Local Storage Fallback',
    databaseMode: 'Relational Database (Users & Notes persistent store)',
    containerName: CONTAINER_NAME,
    azureConnected: isAzureConnected,
    timestamp: new Date().toISOString()
  });
});

// READ: List notes with optional filtering & search (Public)
app.get('/api/notes', async (req, res) => {
  try {
    const { search, subject, semester } = req.query;
    const notes = await db.getAllNotes({ search, subject, semester });
    res.json({ success: true, count: notes.length, notes });
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve notes' });
  }
});

// READ: Get single note by ID (Public)
app.get('/api/notes/:id', async (req, res) => {
  try {
    const note = await db.getNoteById(req.params.id);
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }
    res.json({ success: true, note });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error retrieving note' });
  }
});

// CREATE: Upload note file to Storage & save metadata to Database (Authenticated)
app.post('/api/notes', requireAuth, upload.single('noteFile'), async (req, res) => {
  try {
    const { title, subject, semester, description } = req.body;
    const file = req.file;

    if (!title || !subject) {
      return res.status(400).json({ success: false, message: 'Title and Subject are required.' });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: 'Please attach a study note document file.' });
    }

    const noteId = uuidv4();
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blobName = `${noteId}-${sanitizedFilename}`;
    let fileUrl = '';

    // 1. Store upload notes on Azure Blob Storage
    if (isAzureConnected && containerClient) {
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: {
          blobContentType: file.mimetype || 'application/octet-stream',
          blobContentDisposition: `attachment; filename="${file.originalname}"`
        },
        metadata: {
          title: encodeURIComponent(title.substring(0, 100)),
          author: encodeURIComponent(req.user.name.substring(0, 100)),
          userId: req.user.id,
          noteId: noteId
        }
      });
      fileUrl = blockBlobClient.url;
      console.log(`☁️ Uploaded note to Azure Blob Storage: ${blobName}`);
    } else {
      // Local fallback file save
      const localFilePath = path.join(LOCAL_UPLOADS_DIR, blobName);
      fs.writeFileSync(localFilePath, file.buffer);
      fileUrl = `/uploads/${blobName}`;
      console.log(`💾 Saved note to local storage: ${blobName}`);
    }

    // 2. Store data to Database
    const newNote = {
      id: noteId,
      title: title.trim(),
      subject: subject.trim(),
      semester: semester || req.user.semester || 'General',
      description: (description || '').trim(),
      userId: req.user.id,
      authorName: req.user.name,
      authorEmail: req.user.email,
      fileName: file.originalname,
      blobName: blobName,
      fileSize: file.size,
      mimeType: file.mimetype,
      fileUrl: fileUrl,
      storageType: isAzureConnected ? 'Azure Blob Storage' : 'Local Storage',
      uploadedAt: new Date().toISOString()
    };

    await db.createNote(newNote);

    res.status(201).json({
      success: true,
      message: `Note uploaded successfully to ${newNote.storageType}!`,
      note: newNote
    });
  } catch (error) {
    console.error('Error uploading note:', error);
    res.status(500).json({ success: false, message: error.message || 'Error uploading note' });
  }
});

// UPDATE: Modify note details (Only note creator can edit)
app.put('/api/notes/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subject, semester, description } = req.body;

    const note = await db.getNoteById(id);
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    // Authorization check
    if (note.userId && note.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only edit notes that you uploaded.' });
    }

    const updated = await db.updateNote(id, {
      title: title ? title.trim() : note.title,
      subject: subject ? subject.trim() : note.subject,
      semester: semester ? semester : note.semester,
      description: description !== undefined ? description.trim() : note.description
    });

    res.json({
      success: true,
      message: 'Note updated successfully in database.',
      note: updated
    });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ success: false, message: 'Failed to update note' });
  }
});

// DELETE: Delete note record from Database & delete file from Azure Blob Storage
app.delete('/api/notes/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const note = await db.getNoteById(id);

    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    // Authorization check
    if (note.userId && note.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only delete notes that you uploaded.' });
    }

    // 1. Delete binary file from Azure Blob Storage
    if (isAzureConnected && containerClient && note.blobName) {
      try {
        const blockBlobClient = containerClient.getBlockBlobClient(note.blobName);
        await blockBlobClient.deleteIfExists();
        console.log(`🗑️ Deleted Azure Blob: ${note.blobName}`);
      } catch (err) {
        console.warn('Could not delete Azure Blob:', err.message);
      }
    }

    // Also delete local file if in fallback mode
    const localFile = path.join(LOCAL_UPLOADS_DIR, note.blobName);
    if (fs.existsSync(localFile)) {
      try { fs.unlinkSync(localFile); } catch {}
    }

    // 2. Delete record from Database
    await db.deleteNote(id);

    res.json({
      success: true,
      message: `Note "${note.title}" and its storage blob deleted successfully.`
    });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ success: false, message: 'Failed to delete note' });
  }
});

// DOWNLOAD / STREAM: Download note file from Azure Blob Storage
app.get('/api/notes/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const note = await db.getNoteById(id);

    if (!note) {
      return res.status(404).send('Note not found');
    }

    // Stream from Azure Blob Storage
    if (isAzureConnected && containerClient && note.blobName) {
      const blockBlobClient = containerClient.getBlockBlobClient(note.blobName);
      const exists = await blockBlobClient.exists();
      if (!exists) {
        return res.status(404).send('File blob not found in Azure Storage');
      }

      const downloadResponse = await blockBlobClient.download();
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(note.fileName)}"`);
      res.setHeader('Content-Type', note.mimeType || 'application/octet-stream');
      return downloadResponse.readableStreamBody.pipe(res);
    }

    // Fallback: local file download
    const localFile = path.join(LOCAL_UPLOADS_DIR, note.blobName);
    if (fs.existsSync(localFile)) {
      return res.download(localFile, note.fileName);
    }

    return res.status(404).send('File not found in storage');
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).send('Error downloading file');
  }
});

app.use('/uploads', express.static(LOCAL_UPLOADS_DIR));

// Start server
app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(`🚀 Study Notes Sharing Portal is running on port ${PORT}`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
  await initAzureStorage();
});
