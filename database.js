const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '[]', 'utf8');
}
if (!fs.existsSync(NOTES_FILE)) {
  fs.writeFileSync(NOTES_FILE, '[]', 'utf8');
}

class Database {
  constructor() {
    this.containerClient = null;
  }

  setCloudContainerClient(client) {
    this.containerClient = client;
  }

  // --- File I/O Helpers ---
  readJson(filePath) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data || '[]');
    } catch (err) {
      console.error(`Error reading ${filePath}:`, err.message);
      return [];
    }
  }

  writeJson(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error(`Error writing ${filePath}:`, err.message);
    }
  }

  // Cloud sync to Azure Blob Storage if available
  async syncToCloud(blobName, data) {
    if (!this.containerClient) return;
    try {
      const jsonContent = JSON.stringify(data, null, 2);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.upload(jsonContent, jsonContent.length, {
        blobHTTPHeaders: { blobContentType: 'application/json' }
      });
    } catch (err) {
      console.warn(`Could not sync ${blobName} to Azure Blob:`, err.message);
    }
  }

  async loadFromCloud(blobName, fallbackFile) {
    if (!this.containerClient) return this.readJson(fallbackFile);
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      const exists = await blockBlobClient.exists();
      if (exists) {
        const downloadResponse = await blockBlobClient.downloadToBuffer();
        const data = JSON.parse(downloadResponse.toString('utf8'));
        // Sync local cache
        this.writeJson(fallbackFile, data);
        return data;
      }
    } catch (err) {
      console.warn(`Could not load ${blobName} from Azure Blob:`, err.message);
    }
    return this.readJson(fallbackFile);
  }

  // --- USER OPERATIONS ---
  async getAllUsers() {
    return await this.loadFromCloud('__database_users.json', USERS_FILE);
  }

  async findUserByEmail(email) {
    if (!email) return null;
    const users = await this.getAllUsers();
    return users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
  }

  async findUserById(id) {
    const users = await this.getAllUsers();
    return users.find(u => u.id === id) || null;
  }

  async createUser(user) {
    const users = await this.getAllUsers();
    users.push(user);
    this.writeJson(USERS_FILE, users);
    await this.syncToCloud('__database_users.json', users);
    return user;
  }

  // --- NOTE OPERATIONS ---
  async getAllNotes(filters = {}) {
    let notes = await this.loadFromCloud('__database_notes.json', NOTES_FILE);

    if (filters.search) {
      const q = filters.search.toLowerCase();
      notes = notes.filter(n =>
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.description && n.description.toLowerCase().includes(q)) ||
        (n.subject && n.subject.toLowerCase().includes(q)) ||
        (n.authorName && n.authorName.toLowerCase().includes(q))
      );
    }

    if (filters.subject && filters.subject !== 'All') {
      notes = notes.filter(n => n.subject.toLowerCase() === filters.subject.toLowerCase());
    }

    if (filters.semester && filters.semester !== 'All') {
      notes = notes.filter(n => n.semester === filters.semester);
    }

    // Sort descending by uploadedAt
    notes.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    return notes;
  }

  async getNoteById(id) {
    const notes = await this.getAllNotes();
    return notes.find(n => n.id === id) || null;
  }

  async createNote(note) {
    const notes = await this.loadFromCloud('__database_notes.json', NOTES_FILE);
    notes.push(note);
    this.writeJson(NOTES_FILE, notes);
    await this.syncToCloud('__database_notes.json', notes);
    return note;
  }

  async updateNote(id, updateData) {
    const notes = await this.loadFromCloud('__database_notes.json', NOTES_FILE);
    const index = notes.findIndex(n => n.id === id);
    if (index === -1) return null;

    notes[index] = {
      ...notes[index],
      ...updateData,
      updatedAt: new Date().toISOString()
    };

    this.writeJson(NOTES_FILE, notes);
    await this.syncToCloud('__database_notes.json', notes);
    return notes[index];
  }

  async deleteNote(id) {
    const notes = await this.loadFromCloud('__database_notes.json', NOTES_FILE);
    const index = notes.findIndex(n => n.id === id);
    if (index === -1) return null;

    const [deleted] = notes.splice(index, 1);
    this.writeJson(NOTES_FILE, notes);
    await this.syncToCloud('__database_notes.json', notes);
    return deleted;
  }
}

module.exports = new Database();
