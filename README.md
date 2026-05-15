# 🦙 Llama Cluster Launcher

A robust, professional-grade Electron GUI for managing distributed `llama.cpp` inference clusters. Easily launch a master inference server locally and connect to multiple remote slave nodes via SSH to scale your LLM workloads.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Electron](https://img.shields.io/badge/Electron-29.0.0-informational)

## ✨ Features

- **Master/Slave Architecture**: Manage a local `llama-server` (Master) and multiple remote `rpc-server` instances (Slaves) from a single interface.
- **SSH Integration**: Seamlessly connect to remote machines, verify connectivity, and launch processes via SSH.
- **Real-time GPU Metrics**: High-performance monitoring of GPU Utilization, VRAM usage, and Power draw for all nodes using `nvidia-smi`.
- **Flash Attention Support**: Fine-grained control over `--flash-attn` (auto, on, off) for optimized inference.
- **Live Terminal Output**: Real-time streaming of stdout/stderr from all nodes with intelligent log coloring.
- **Persistence**: Remembers your configurations, paths, and slave node lists across sessions.
- **Modern Monotone UI**: A sleek, dark-themed interface designed for focused engineering work.

## 🚀 Getting Started

### Prerequisites

- **Local**: Linux/macOS with [Node.js](https://nodejs.org/) installed.
- **Remote**: SSH access to machines with `llama.cpp` binaries pre-compiled.
- **Hardware**: NVIDIA GPUs are recommended (for `nvidia-smi` metrics).

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/llama-cluster-launcher.git
   cd llama-cluster-launcher
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the application:
   ```bash
   npm start
   ```

## 🛠 Usage

1. **Configure Master**: Select your `llama-server` binary and the `.gguf` model file. Adjust context size, layers, and Flash Attention settings.
2. **Add Slaves**: Click **+ Add Node** to configure remote machines. Enter SSH credentials and the path to the `rpc-server` binary on the remote host.
3. **Launch**:
   - Start the **Slave Nodes** first to initialize the RPC servers.
   - Click **Launch Master** to begin inference.
4. **Monitor**: Watch the GPU dials and terminal logs to ensure the cluster is performing optimally.

## 🏗 Technologies

- **Electron**: Cross-platform desktop framework.
- **ssh2**: Pure JavaScript SSH2 client for node.js.
- **electron-store**: Simple data persistence for your settings.
- **Vanilla CSS**: Custom-built design system with a monotone aesthetic.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

*Built with ❤️ for the LLM community.*
