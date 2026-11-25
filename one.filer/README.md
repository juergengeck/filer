# OneFiler

**Linux/Unix FUSE implementation for ONE database content.**

Linux/FUSE and Debian packaging remain supported. The WSL Windows installation
instructions in this historical document are retired, and the old Windows
installer refuses to run. Current Windows development and packaging are documented
in [native Windows Filer](../windows/README.md).

> Implements a dual-pathway data ingestion system: structured data → ONE objects, unstructured data → BLOB/CLOB with metadata

## 🎯 Project Overview

OneFiler creates a transparent bridge between Windows Explorer and the ONE database system via WSL2, enabling:

- **Native Windows Explorer integration** - Files appear as regular Windows folders
- **Automatic data classification** - Smart routing to ONE objects or BLOB storage  
- **WSL2-powered backend** - Leverages Linux-native ONE runtime performance
- **Zero-setup user experience** - Works like any normal Windows directory

## 📋 Project Management

This project uses **TaskMaster AI** for development planning and task management.

### Current Status: **50% Complete** (6/12 tasks)
- ✅ WSL2 + Node.js Environment  
- ✅ Windows File System Integration
- ✅ Windows Explorer Integration  
- ✅ Enhanced File System Recipes
- ✅ Debian Package Creation
- ✅ Windows Installer
- 🔄 **Next:** Two-Tier Data Ingestion Pipeline (Task 8)

### TaskMaster Commands
```bash
# View all tasks
npx task-master-ai list --with-subtasks

# Get next task to work on  
npx task-master-ai next

# Update task status
npx task-master-ai set-status --id=8 --status=in-progress

# Break down complex tasks
npx task-master-ai expand --id=8 --research
```

## 🚀 Quick Start

### Prerequisites
- **Windows 10/11** with WSL2 enabled
- **Node.js 16+** (installed in WSL2)
- **Git** with SSH key access to ONE repositories
- **WinFSP** for Windows FUSE support
- **Ollama** (optional, for local AI assistance)

### Installation

#### 1. Windows Setup
```bash
# Install WinFSP
# Download from: https://github.com/winfsp/winfsp/releases
# Enable Core & Development Features during installation

# Clone repository
git clone https://github.com/juergengeck/one.filer.git
cd one.filer
```

#### 2. WSL2 Setup  
```bash
# Install dependencies
npm install

# Build project
npm run build

# Start the filer
npm run start-filer
```

#### 3. TaskMaster Setup (Optional)
```bash
# Initialize TaskMaster
npx task-master-ai init

# Configure with local Ollama (if available)
npx task-master-ai models --set-main=gemma2:latest --ollama
```

## 📁 Project Structure

```
one.filer/
├── src/                    # TypeScript source code
│   ├── filer/             # Core filer implementation  
│   ├── fileSystems/       # File system adapters
│   ├── commands/          # CLI commands
│   └── misc/              # Utilities and helpers
├── scripts/               # Setup and deployment scripts
├── tasks/                 # TaskMaster task definitions
├── configs/               # Configuration files
├── debian/                # Debian packaging
└── windows-installer/     # Windows installer
```

## 🔧 Development

### Using npm link for ONE Dependencies
```bash
# Step 1: Clone and link ONE libraries
git clone <one.core-repo> ../one.core
git clone <one.models-repo> ../one.models

# Step 2: Link to this project
npm link ../one.core ../one.models

# Step 3: Link models to core
cd ../one.models  
npm link ../one.core
```

### TaskMaster Workflow
1. **Check current status:** `npx task-master-ai next`
2. **Start working:** `npx task-master-ai set-status --id=X --status=in-progress`
3. **Break down tasks:** `npx task-master-ai expand --id=X --research`
4. **Update progress:** `npx task-master-ai update-subtask --id=X.Y --prompt="Progress update"`
5. **Mark complete:** `npx task-master-ai set-status --id=X --status=done`

## 🏗️ Architecture

### Two-Tier Data Ingestion Pipeline
- **Structured Data Path:** JSON, XML, CSV → ONE Objects
- **Unstructured Data Path:** Binary files → BLOB/CLOB + metadata
- **Smart Detection:** Automatic file type classification  
- **Windows Compatibility:** Full Explorer integration

### WSL2-Windows Bridge
- **FUSE Frontend:** Windows Explorer compatibility
- **WSL2 Backend:** Native ONE runtime performance  
- **Service Management:** Auto-start integration
- **Error Handling:** Robust cross-boundary operations

## 📖 Documentation

- **[Project PRD](scripts/prd.txt)** - Complete project requirements
- **[TaskMaster Tasks](tasks/)** - Current development plan
- **[Setup Scripts](scripts/)** - Automated installation helpers

## 🛠️ Platform-Specific Installation

### For Windows
In case pthreads installation with vcpkg shows error about not finding visual studio instance, download `C++ CMake tools for Windows` individual component from https://visualstudio.microsoft.com/downloads/ community visual studio installer.

Python is required. Tested with version 3.*

- Get WinFSP from [here](https://github.com/winfsp/winfsp/releases/tag/v1.8) (the .msi file) and 
  install it. In the installation prompt, enable Core & Development Features
- `npm install` (in one.filer)
- `npm run build`
- `npm run start-filer`

### For Linux
- `npm install -g fuse-native`
- make node, npm and fuse-native available for sudo
    - `sudo ln -s /home/ubuntu/.nvm/versions/node/v16.18.0/bin/node /usr/local/bin/node`
    - `sudo ln -s /home/ubuntu/.nvm/versions/node/v16.18.0/bin/npm /usr/local/bin/npm`
    - `sudo ln -s /home/ubuntu/.nvm/versions/node/v16.18.0/bin/fuse-native /usr/local/bin/fuse-native`
- `fuse-native is-configured` # checks if the kernel extension is already configured
- `sudo fuse-native configure` # configures the kernel extension
- `npm install`
- `npm run build`
- `npm run start`

### For macOS
- `npm install`
- `npm run build`
- `npm run start`

## 🔍 Debugging

I added a lsone.sh file. It lists the contents of the one datbase in human-readable format.
Requirements: bash, sed and tidy and a console that understands ansi colors.

## 🤝 Contributing

1. Check TaskMaster for current priorities: `npx task-master-ai next`
2. Follow the development workflow outlined above
3. Update task status as you progress
4. Create PRs against the main branch

## 📄 License

See [LICENSE.md](LICENSE.md) for details.
