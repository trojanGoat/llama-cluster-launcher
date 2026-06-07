# 🦙 Llama Cluster Launcher — User Manual

A complete guide to setting up, configuring, and running a distributed `llama.cpp` inference cluster with the Llama Cluster Launcher.

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Prerequisites](#2-prerequisites)
3. [Installation](#3-installation)
4. [Quick Start](#4-quick-start)
5. [Configuring the Node0 Node](#5-configuring-the-node0-node)
6. [Configuring Node Nodes](#6-configuring-node-nodes)
7. [Launching Your Cluster](#7-launching-your-cluster)
8. [Monitoring GPU Metrics](#8-monitoring-gpu-metrics)
9. [⚠️ SSH Security — Read This First](#9-️-ssh-security--read-this-first)
10. [⚠️ RPC Traffic Security](#10-️-rpc-traffic-security)
11. [Settings & Persistence](#11-settings--persistence)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Overview & Architecture

Llama Cluster Launcher is an Electron-based GUI that orchestrates a **distributed LLM inference cluster** using `llama.cpp`'s built-in RPC (Remote Procedure Call) backend.

### How it works

```
┌─────────────────────────────────────────┐      ┌──────────────────────────┐
│           YOUR LOCAL MACHINE            │      │     REMOTE GPU NODE 1    │
│                                         │      │                          │
│  ┌───────────────────────────────────┐  │ SSH  │  ┌────────────────────┐  │
│  │    Llama Cluster Launcher (GUI)   │──┼─────▶│  │    rpc-server      │  │
│  └───────────────┬───────────────────┘  │      │  │  (listens :52396)  │  │
│                  │ spawns               │      │  └────────────────────┘  │
│  ┌───────────────▼───────────────────┐  │ RPC  │                          │
│  │         llama-server (Node0)     │◀─┼─────▶│  GPU offload layers      │
│  │  (loads model, handles HTTP API)  │  │      └──────────────────────────┘
│  └───────────────────────────────────┘  │
│  http://localhost:8080 (OpenAI compat.) │      ┌──────────────────────────┐
└─────────────────────────────────────────┘      │     REMOTE GPU NODE 2    │
                                                 │  ┌────────────────────┐  │
                                                 │  │    rpc-server      │  │
                                                 │  │  (listens :52396)  │  │
                                                 │  └────────────────────┘  │
                                                 └──────────────────────────┘
```

- **Node0 Node**: Runs `llama-server` **locally** on your machine. Loads the model, handles all inference requests over an OpenAI-compatible HTTP API, and delegates GPU computation to node nodes via RPC.
- **Node Nodes**: Remote machines running `rpc-server`. The GUI connects over SSH and launches the RPC server process for you. The node0 then offloads model layers to each node's GPU.

This allows you to spread a large model (e.g., 70B+) across multiple GPUs on different machines on your local network.

---

## 2. Prerequisites

### On your local machine (Node0)
- **Linux or macOS** with [Node.js ≥ 18](https://nodejs.org/) installed
- [`llama.cpp`](https://github.com/ggerganov/llama.cpp) compiled with CUDA support (`llama-server` binary)
- A `.gguf` model file
- NVIDIA GPU (recommended) — or CPU-only at reduced performance

### On each remote machine (Node)
- Linux with SSH server running (`openssh-server`)
- `llama.cpp` compiled with CUDA support (`rpc-server` binary)
- NVIDIA GPU(s) with CUDA drivers installed

### Network
- All machines on the **same local network** (LAN) — do **not** expose RPC ports to the public internet (see [Section 10](#10-️-rpc-traffic-security))
- SSH access from your local machine to each node

---

## 3. Installation

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/llama-cluster-launcher.git
cd llama-cluster-launcher

# 2. Install dependencies
npm install

# 3. Launch the app
npm start
```

---

## 4. Quick Start

1. **Configure your Node0** — set the path to `llama-server` and your `.gguf` model.
2. **Add Node Nodes** — click **+ Add Node** for each remote GPU machine and fill in SSH credentials and the path to `rpc-server`.
3. **Start Nodes first** — click **▶ Launch** on each node card. Wait for the terminal to show `rpc_server: listening on …`.
4. **Start Node0** — click **Launch Node0**. Watch it connect to nodes and begin loading model layers.
5. **Query the API** — Once node0 shows `HTTP server listening`, send requests to `http://localhost:8080/v1/chat/completions`.

---

## 5. Configuring the Node0 Node

| Field | Description |
|-------|-------------|
| **llama-server binary** | Path to your compiled `llama-server` binary. Use 📂 to browse. |
| **Model file (.gguf)** | Path to your quantized model. Use 📂 to browse. |
| **Port** | HTTP port for the inference API (default: `8080`). Checked for availability before launch. |
| **Bind Host** | Network interface to bind. `0.0.0.0` accepts from all interfaces; `127.0.0.1` for localhost only. |
| **--rpc (node addresses)** | Auto-populated from your configured node nodes. Read-only. |
| **GPU Layers (-ngl)** | Layers offloaded to GPU. `99` = maximum. Reduce if you run out of VRAM. |
| **Context Size (-c)** | Maximum context length in tokens. Larger contexts require more VRAM. `32768` is a good default. |
| **KV Cache Key Type (-ctk)** | `q8_0` recommended — excellent balance of quality vs. VRAM savings. |
| **KV Cache Value Type (-ctv)** | `q8_0` recommended. |
| **Parallel Slots (-np)** | Number of concurrent inference requests. `1` for best single-user performance. |
| **Flash Attention** | `auto` lets the hardware decide. Enable (`on`) if supported for lower VRAM usage. |
| **Additional Flags** | Any extra flags appended verbatim (e.g., `--threads 8 --numa distribute`). |

The **Command Preview** box shows the exact command that will be executed — you can copy it to run manually in a terminal.

---

## 6. Configuring Node Nodes

Click **+ Add Node** to add a node card. Each card has:

| Field | Description |
|-------|-------------|
| **Node name** | A friendly label (editable inline). |
| **IP Address** | The node machine's LAN IP. Also used as the `-H` bind address for `rpc-server`. |
| **SSH Username** | The user account on the remote machine. |
| **SSH Password** | Password for SSH authentication. ⚠️ **Read Section 9 — SSH Keys are strongly preferred.** |
| **rpc-server path (remote)** | Full path to the `rpc-server` binary on the remote machine. `~` expansion is supported. |
| **RPC Port (-p)** | Port `rpc-server` listens on (default: `52396`). Must match across node0 and node. |
| **Additional Flags** | Extra flags for `rpc-server` (e.g., `--mem-base 0`). |

### Test SSH button
Click **Test SSH** on any node card to verify connectivity before launching. It opens and immediately closes an SSH connection — it does not run any commands.

### Remote Port Check
Before launching a node, the app does an SSH read-only port check (`ss -tlnp`) to verify the RPC port is not already in use.

---

## 7. Launching Your Cluster

### Correct Launch Order

> [!IMPORTANT]
> **Always start Node Nodes BEFORE the Node0.** The node0 needs the RPC servers to already be listening when it loads model layers.

```
Step 1: Launch all Node Nodes  →  Wait for "rpc_server: listening on …"
Step 2: Launch Node0           →  Wait for "HTTP server listening on …"
Step 3: Send API requests       →  curl / LM Studio / any OpenAI-compat client
```

### Stopping

- Click **■ Stop Node0** to terminate the local `llama-server` process.
- Click **■ Stop** on each node card to send `SIGTERM` and close the SSH session.
- Closing the app sends a `pkill -f rpc-server` to each node before disconnecting.

---

## 8. Monitoring GPU Metrics

Once running, each panel displays three live GPU dials (refreshed every 2.5s via `nvidia-smi`):

| Dial | Description | Warning Threshold |
|------|-------------|-------------------|
| **GPU Utilization** | Compute usage % | 🟡 >70% · 🔴 >90% |
| **VRAM Usage** | Memory used vs total | 🟡 >75% · 🔴 >92% |
| **Power Draw** | Watts (scaled to 350W max) | 🟡 >80% · 🔴 >95% |

Nodes reuse their existing SSH connection for GPU polling — no extra connections are opened.

---

## 9. ⚠️ SSH Security — Read This First

> [!WARNING]
> **This application stores SSH credentials locally using encrypted storage (`electron-store` with AES encryption). However, password-based SSH is inherently weaker than key-based authentication. We strongly recommend using SSH keys.**

### Why SSH Keys Are Safer

SSH password authentication requires transmitting a password over the network (even when encrypted). A compromised local machine, a keylogger, or a brute-force attack on your SSH daemon can expose your credentials.

**SSH key pairs** (`id_ed25519` / `id_ed25519.pub`) use public-key cryptography — the private key never leaves your local machine.

### Setting Up SSH Key Authentication (Recommended)

```bash
# 1. Generate an Ed25519 key pair (modern, fast, secure)
ssh-keygen -t ed25519 -C "llama-cluster" -f ~/.ssh/llama_cluster_key

# 2. Copy the public key to each node machine
ssh-copy-id -i ~/.ssh/llama_cluster_key.pub ubuntu@192.168.8.101
ssh-copy-id -i ~/.ssh/llama_cluster_key.pub ubuntu@192.168.8.102

# 3. Test passwordless login
ssh -i ~/.ssh/llama_cluster_key ubuntu@192.168.8.101
```

> [!IMPORTANT]
> **SSH Key support in the GUI is coming in a future release.** For now, to use key-based auth without a password field, configure your local `~/.ssh/config`:
>
> ```
> Host gpu-node-1
>     HostName 192.168.8.101
>     User ubuntu
>     IdentityFile ~/.ssh/llama_cluster_key
>     IdentitiesOnly yes
> ```
>
> Then enter `gpu-node-1` as the IP and leave the password blank. The `ssh2` library will fall back to your SSH agent or `~/.ssh/config`.

### Disabling Password Authentication on Nodes

Once you have keys working, **disable password auth** on each node:

```bash
# On each node machine:
sudo nano /etc/ssh/sshd_config

# Set these values:
PasswordAuthentication no
ChallengeResponseAuthentication no

# Restart SSH
sudo systemctl restart sshd
```

This means even if someone gets your password, they cannot log in via SSH.

### Additional SSH Hardening

- **Use a non-standard SSH port**: Change from `22` to reduce automated scanning (update the port field in the node card).
- **Use `fail2ban`**: Automatically blocks IPs with repeated failed logins.
- **Use `ufw` or `iptables`**: Restrict SSH access to only your local subnet:
  ```bash
  sudo ufw allow from 192.168.8.0/24 to any port 22
  sudo ufw deny 22
  ```

---

## 10. ⚠️ RPC Traffic Security

> [!CAUTION]
> **The `rpc-server` protocol used by `llama.cpp` is UNENCRYPTED and UNAUTHENTICATED. Any machine that can reach the RPC port can send arbitrary tensor data to it. Never expose RPC ports to the public internet.**

### Safe Usage Rules

1. **LAN Only**: Only run this on a trusted private network. All nodes should be on the same physical network or VLAN.
2. **Firewall RPC Ports**: Block port `52396` (or whichever port you use) from external access:
   ```bash
   # On each node — allow RPC only from node0's IP
   sudo ufw allow from 192.168.8.100 to any port 52396
   sudo ufw deny 52396
   ```
3. **Avoid Public Wi-Fi**: Never run this cluster on an untrusted network.

### Using SSH Tunnels for Extra Security

If you need to connect to a node over an untrusted network, use SSH port forwarding to encrypt the RPC traffic:

```bash
# On your local machine, create an encrypted tunnel for the RPC port:
ssh -L 52396:localhost:52396 -N ubuntu@192.168.8.101

# Then in the GUI, set the node IP to 127.0.0.1 — traffic goes through the SSH tunnel
```

---

## 11. Settings & Persistence

All settings are automatically saved using `electron-store` with AES encryption. Your configuration (paths, node IPs/credentials, parameters) is stored in:

| Platform | Location |
|----------|----------|
| **Linux** | `~/.config/llama-cluster-launcher/config.json` |
| **macOS** | `~/Library/Application Support/llama-cluster-launcher/config.json` |
| **Windows** | `%APPDATA%\llama-cluster-launcher\config.json` |

> [!NOTE]
> This file is **local only** and never committed to this repository. Settings persist across restarts automatically.

---

## 12. Troubleshooting

### SSH Connection Fails

- **"Authentication failed"**: Wrong username/password. If using keys, ensure `~/.ssh/config` is set up correctly.
- **"Connection refused"**: SSH daemon not running on node (`sudo systemctl start sshd`).
- **"Host unreachable"**: Check that both machines are on the same network and IPs are correct.
- **Timeout**: Check firewall rules — port 22 may be blocked.

### Node0 Fails to Start

- **"Port already in use"**: Another process is using the configured port. Change the port or kill the conflicting process (`fuser -k 8080/tcp`).
- **"No such file"**: Binary path is wrong. Use the 📂 browser to locate it.
- **"Permission denied"**: Make the binary executable: `chmod +x /path/to/llama-server`.

### Model Loads Slowly / OOM Errors

- Reduce **GPU Layers (-ngl)** to leave some VRAM headroom.
- Switch **KV Cache Type** to `q4_0` for aggressive VRAM savings.
- Reduce **Context Size** — `4096` or `8192` uses far less VRAM than `32768`.

### GPU Dials Show No Data

- Verify `nvidia-smi` is installed on the relevant machine.
- Remote GPU metrics only appear after a node is in the **Running** state and SSH is active.

### Node Terminal Shows `bash: rpc-server: command not found`

- The full path to `rpc-server` is required. Update the **rpc-server path** field:
  ```
  /home/ubuntu/llama.cpp/build/bin/rpc-server
  ```
  (`~` expansion works — `~/llama.cpp/build/bin/rpc-server` is fine too.)

---

*Built with ❤️ for the LLM community.*
