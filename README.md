# Study Notes Sharing Portal (Group No. 7)

**CSA-302: Cloud Computing Practical Assignment (T.Y.B.C.A)**  
*Dnyanprassarak Mandal's College and Research Centre, Assagao, Bardez, Goa*

---

## 📌 Project Overview
- **Project Title:** Study Notes Sharing Portal
- **Group No.:** 7
- **Authentication:** Student Registration & Login with **bcryptjs password hashing** & **JSON Web Tokens (JWT)**
- **Database Layer:** Structured database store for user credentials & document metadata (SQL schema included in `schema.sql`)
- **Cloud Storage:** **Azure Blob Storage** for high-availability document storage (PDFs, DOCX, PPTX)
- **Cloud Compute:** **Azure App Service** (Node.js 20 LTS runtime)
- **Data Status:** Clean, production-ready database with all dummy records removed.

---

## 🏗️ Architecture & Features

```
[ Student / Browser Client ]
           |
           v (HTTPS)
[ Azure App Service (Node.js / Express) ]
     /                          \
    v                            v
[ Database Layer ]      [ Azure Blob Storage ]
- Users Table           - Container: 'study-notes'
- Notes Metadata        - Raw binary documents (PDF, DOCX)
```

### Complete Authenticated CRUD Operations:
1. **User Authentication:** 
   - Register account (Name, Email, Roll Number, Semester, Password).
   - Secure login generating a 7-day signed JWT session token.
2. **Create (Upload):** Authenticated students upload study files directly to Azure Blob Storage; note metadata is linked to their user account in the database.
3. **Read (Browse & Search):** Public browsing with real-time keyword search, subject filters, and semester filters.
4. **Update (Edit):** Note authors can edit their note details (protected by JWT ownership check).
5. **Delete:** Note authors can delete their notes, permanently removing the record from the database and the blob from Azure Blob Storage.
6. **Download:** Direct streaming from Azure Blob Storage.

---

## 🚀 Quick Start (Local Run)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Application
```bash
npm start
```
Visit `http://localhost:3000` in your web browser.

### 3. Connect to Microsoft Azure Blob Storage
Create a `.env` file in the project root:
```env
AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=<your_storage_account>;AccountKey=<your_key>;EndpointSuffix=core.windows.net"
AZURE_CONTAINER_NAME="study-notes"
JWT_SECRET="your-secure-jwt-secret-key"
PORT=3000
```
When restarted, the portal automatically binds to your Azure Blob container.
