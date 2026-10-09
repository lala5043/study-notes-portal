-- =========================================================================
-- Azure SQL / Relational Database Schema for Study Notes Sharing Portal
-- Course: CSA-302 Cloud Computing Practical Assignment (Group 7)
-- =========================================================================

-- 1. Users Table (Stores student credentials & profiles)
CREATE TABLE IF NOT EXISTS users (
    id NVARCHAR(50) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    email NVARCHAR(150) NOT NULL UNIQUE,
    password NVARCHAR(255) NOT NULL,
    roll_number NVARCHAR(50),
    semester NVARCHAR(50),
    created_at DATETIME2 DEFAULT CURRENT_TIMESTAMP
);

-- 2. Notes Table (Stores document metadata linked to Azure Blob Storage)
CREATE TABLE IF NOT EXISTS notes (
    id NVARCHAR(50) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    subject NVARCHAR(100) NOT NULL,
    semester NVARCHAR(50) NOT NULL,
    description NVARCHAR(MAX),
    user_id NVARCHAR(50) NOT NULL,
    author_name NVARCHAR(100) NOT NULL,
    file_name NVARCHAR(255) NOT NULL,
    blob_name NVARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type NVARCHAR(100),
    file_url NVARCHAR(500),
    storage_type NVARCHAR(50) DEFAULT 'Azure Blob Storage',
    uploaded_at DATETIME2 DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME2,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for fast searching & filtering
CREATE INDEX IX_notes_subject ON notes(subject);
CREATE INDEX IX_notes_semester ON notes(semester);
CREATE INDEX IX_notes_user_id ON notes(user_id);
