import asyncio
import json
import os
import sys
import socket
import subprocess
import urllib.request
import base64
from pathlib import Path
try:
    from tree_sitter_languages import get_language, get_parser
    TS_AVAILABLE = True
except ImportError:
    TS_AVAILABLE = False
from pydantic import BaseModel

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, APIRouter, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import os

try:
    import openai
    from anthropic import Anthropic
    from groq import Groq
    API_PROVIDERS_AVAILABLE = True
except ImportError:
    API_PROVIDERS_AVAILABLE = False

app = FastAPI(title="AiderWeb")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

PROJECTS_FILE = Path.home() / ".aiderwebapp" / "projects.json"
DEFAULT_MODEL  = "ollama/qwen3-coder:480b-cloud"

# Shared skip set — used everywhere, defined once
SKIP = {'node_modules', '__pycache__', '.git', '.next', 'dist', 'build', '.venv', 'venv', '.cache'}


# ── Helpers ────────────────────────────────────
def get_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "localhost"

def run_cmd(cmd, cwd=None, timeout=10):
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except:
        return ""


# ── File System ────────────────────────────────
fs = APIRouter(prefix="/api/fs")

@fs.get("/list")
async def list_dir(path: str):
    try:
        p = Path(path)
        if not p.exists() or not p.is_dir():
            return {"error": "Not a directory"}
        items = []
        for item in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if item.name.startswith('.') or item.name in SKIP:
                continue
            items.append({
                "name":  item.name,
                "path":  str(item).replace("\\", "/"),
                "isDir": item.is_dir(),
                "ext":   item.suffix.lower()
            })
        return {"items": items}
    except Exception as e:
        return {"error": str(e)}

@fs.get("/read")
async def read_file(path: str):
    try:
        return {"content": Path(path).read_text(encoding="utf-8", errors="replace")}
    except Exception as e:
        return {"error": str(e)}

class WriteBody(BaseModel):
    path: str
    content: str

@fs.post("/write")
async def write_file(body: WriteBody):
    try:
        p = Path(body.path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body.content, encoding="utf-8")
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}

class FileActionBody(BaseModel):
    path: str
    new_path: str = ""

@fs.post("/create")
async def create_file(body: FileActionBody):
    try:
        p = Path(body.path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.touch(exist_ok=True)
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}

@fs.post("/rename")
async def rename_file(body: FileActionBody):
    try:
        p = Path(body.path)
        np = Path(body.new_path)
        np.parent.mkdir(parents=True, exist_ok=True)
        p.rename(np)
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}

@fs.delete("/delete")
async def delete_file(path: str):
    try:
        p = Path(path)
        if p.is_file():
            p.unlink()
        elif p.is_dir():
            import shutil
            shutil.rmtree(p)
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}

@fs.get("/search")
async def search_files(path: str, q: str):
    try:
        p = Path(path)
        results = []
        for f in p.rglob("*"):
            if not f.is_file() or any(s in f.parts for s in SKIP): continue
            if f.suffix.lower() not in TEXT_EXTS: continue
            
            try:
                content = f.read_text(encoding="utf-8", errors="ignore")
                lines = content.split('\n')
                for i, line in enumerate(lines):
                    if q.lower() in line.lower():
                        results.append({
                            "file": str(f.relative_to(p)).replace("\\", "/"),
                            "line": i + 1,
                            "text": line.strip()
                        })
                        if len(results) > 100:
                            break
            except: continue
        return {"results": results[:100]}
    except Exception as e:
        return {"error": str(e)}


# ── File Uploads (Drag & Drop) ─────────────────
upload = APIRouter(prefix="/api/upload")
MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5 MB

@upload.post("")
async def upload_file(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        if len(contents) > MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="File too large. Max size is 5MB.")
            
        ext = Path(file.filename).suffix.lower()
        
        # If it's an image, return base64 for vision models
        if ext in ['.png', '.jpg', '.jpeg', '.webp']:
            b64 = base64.b64encode(contents).decode('utf-8')
            return {"filename": file.filename, "type": "image", "content": b64, "size": len(contents)}
            
        # Otherwise, assume it's text
        text = contents.decode('utf-8', errors='replace')
        return {"filename": file.filename, "type": "text", "content": text, "size": len(contents)}
        
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Projects & Settings & History ────────────────
proj = APIRouter(prefix="/api/projects")
SETTINGS_FILE = Path.home() / ".aiderwebapp" / "settings.json"

@proj.get("")
async def get_projects():
    try:
        if PROJECTS_FILE.exists():
            return json.loads(PROJECTS_FILE.read_text())
        return []
    except:
        return []

class Project(BaseModel):
    name: str
    path: str

@proj.post("")
async def save_projects(projects: list[Project]):
    PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROJECTS_FILE.write_text(json.dumps([p.dict() for p in projects]))
    return {"ok": True}

@proj.get("/settings")
async def get_settings():
    try:
        if SETTINGS_FILE.exists():
            s = json.loads(SETTINGS_FILE.read_text())
            if "system_prompt" not in s:
                s["system_prompt"] = DEFAULT_SYSTEM_PROMPT
            return s
        return {"system_prompt": DEFAULT_SYSTEM_PROMPT}
    except:
        return {"system_prompt": DEFAULT_SYSTEM_PROMPT}

@proj.post("/settings")
async def save_settings(settings: dict):
    try:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps(settings))
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}

@proj.get("/history")
async def get_history(project_path: str):
    """Get chat history for a specific project based on a hashed file path."""
    import hashlib
    try:
        hashed = hashlib.md5(project_path.encode()).hexdigest()
        hist_file = SETTINGS_FILE.parent / f"history_{hashed}.json"
        if hist_file.exists():
            return {"messages": json.loads(hist_file.read_text())}
        return {"messages": []}
    except:
        return {"messages": []}

@proj.post("/history")
async def save_history(project_path: str, messages: list):
    import hashlib
    try:
        # Before saving, extract any Memory blocks the AI decided to save
        memory_updates = []
        for m in messages:
            if m.get("role") == "ai":
                content = m.get("content", "")
                import re
                mem_matches = re.findall(r'<<<REMEMBER\n(.*?)\n>>>', content, re.DOTALL)
                memory_updates.extend(mem_matches)
        
        hashed = hashlib.md5(project_path.encode()).hexdigest()
        if memory_updates:
            mem_file = SETTINGS_FILE.parent / f"memory_{hashed}.json"
            existing_mem = []
            if mem_file.exists():
                try: existing_mem = json.loads(mem_file.read_text())
                except: pass
            
            for new_mem in memory_updates:
                if new_mem.strip() not in existing_mem:
                    existing_mem.append(new_mem.strip())
            
            mem_file.parent.mkdir(parents=True, exist_ok=True)
            mem_file.write_text(json.dumps(existing_mem))

    except Exception:
        pass
        
    try:
        hashed = hashlib.md5(project_path.encode()).hexdigest()
        hist_file = SETTINGS_FILE.parent / f"history_{hashed}.json"
        hist_file.parent.mkdir(parents=True, exist_ok=True)
        # We don't save full stream buffers, just clean content
        clean_msgs = []
        for m in messages:
            clean_msgs.append({
                "role": m.get("role"),
                "content": m.get("content"),
                "events": m.get("events", []),
                "editedFiles": m.get("editedFiles", [])
            })
        hist_file.write_text(json.dumps(clean_msgs))
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}


# ── Git ────────────────────────────────────────
git = APIRouter(prefix="/api/git")

@git.get("/status")
async def git_status(path: str):
    return {
        "branch": run_cmd(["git", "branch", "--show-current"], cwd=path),
        "status": run_cmd(["git", "status", "--short"],        cwd=path),
        "log":    run_cmd(["git", "log", "--oneline", "-8"],   cwd=path),
    }

@git.get("/diff")
async def git_diff(path: str):
    """Returns the unstaged git diff for the project."""
    return {"diff": run_cmd(["git", "diff"], cwd=path)}

class GitCommitBody(BaseModel):
    path: str
    message: str

@git.post("/commit")
async def git_commit(body: GitCommitBody):
    try:
        run_cmd(["git", "add", "."], cwd=body.path)
        out = run_cmd(["git", "commit", "-m", body.message], cwd=body.path)
        return {"ok": True, "output": out}
    except Exception as e:
        return {"error": str(e)}

@git.post("/push")
async def git_push(path: str):
    try:
        out = run_cmd(["git", "push"], cwd=path)
        return {"ok": True, "output": out}
    except Exception as e:
        return {"error": str(e)}

@git.post("/undo")
async def git_undo(path: str):
    """Reverts the last commit (which is usually an auto-commit by the AI)."""
    try:
        out = run_cmd(["git", "reset", "--hard", "HEAD~1"], cwd=path)
        return {"ok": True, "output": out}
    except Exception as e:
        return {"error": str(e)}


# ── Models ─────────────────────────────────────
mdl = APIRouter(prefix="/api/models")

CLOUD_MODELS = [
    "deepseek-coder-v2:236b",
    "deepseek-v3.1:671b-cloud",
    "qwen2.5-coder:32b",
    "qwen2.5:72b",
    "llama3.1:405b",
    "llama3.1:70b",
    "mixtral:8x22b",
    "command-r-plus:104b",
    "gemma2:27b",
    "phi3.5:14b",
    "gpt-4o-proxy",
    "claude-3.5-sonnet-proxy"
]

@mdl.get("")
async def get_models():
    """Return all installed models split into cloud vs local."""
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3) as r:
            data   = json.loads(r.read())
            all_m  = [m["name"] for m in data.get("models", [])]
            
            # If the user has pulled standard cloud models, we identify them
            # We'll just define 'cloud' as either massive models, proxy models, or explicitly named 'cloud'
            local = []
            cloud_found = list(CLOUD_MODELS) # Always show our predefined cloud models
            for m in all_m:
                if m not in cloud_found and ("cloud" not in m and "proxy" not in m):
                    local.append(m)
                elif m not in cloud_found:
                    cloud_found.append(m)
                    
            return {"models": cloud_found + local, "cloud": cloud_found, "local": local, "online": True}
    except:
        # Ollama offline — return known cloud model names so UI still works
        return {"models": CLOUD_MODELS, "cloud": CLOUD_MODELS, "local": [], "online": False}

@mdl.delete("/local")
async def delete_local_models():
    """Delete all local (non-cloud) models to free disk space."""
    deleted, failed = [], []
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3) as r:
            data        = json.loads(r.read())
            local_names = [m["name"] for m in data.get("models", []) if "cloud" not in m["name"]]

        for name in local_names:
            result = subprocess.run(["ollama", "rm", name],
                                    capture_output=True, text=True, timeout=30)
            (deleted if result.returncode == 0 else failed).append(name)

        return {"ok": len(failed) == 0, "deleted": deleted, "failed": failed}
    except Exception as e:
        return {"ok": False, "error": str(e), "deleted": deleted, "failed": failed}


# ── Project Scan ───────────────────────────────
scan = APIRouter(prefix="/api/scan")

@scan.get("")
async def scan_project(path: str):
    try:
        p     = Path(path)
        files = []
        for f in p.rglob("*"):
            if f.is_file() and not any(s in f.parts for s in SKIP) and not f.name.startswith('.'):
                rel = str(f.relative_to(p)).replace("\\", "/")
                files.append({"path": rel, "size": f.stat().st_size, "ext": f.suffix})

        has   = {f["path"] for f in files}
        ptype = "unknown"
        if "package.json" in has and any(f.endswith((".jsx", ".tsx")) for f in has):
            ptype = "react"
        elif "package.json" in has:
            ptype = "nodejs"
        elif "requirements.txt" in has or any(f.endswith(".py") for f in has):
            ptype = "python"

        return {"files": files, "type": ptype, "count": len(files)}
    except Exception as e:
        return {"error": str(e)}


# ── Direct Ollama Agent (no Aider) ─────────────
# Uses precision Git-style merge diff patches rather than rewriting whole files.
# Supports auto-commit for undo.

TEXT_EXTS = {
    '.py','.js','.jsx','.ts','.tsx','.mjs','.cjs',
    '.html','.css','.scss','.sass','.less',
    '.json','.yaml','.yml','.toml','.ini','.env','.cfg','.conf',
    '.md','.txt','.rst','.xml','.svg',
    '.sh','.bat','.ps1','.cmd',
    '.sql','.prisma','.graphql',
    '.vue','.svelte','.astro',
    '.go','.rs','.java','.kt','.swift','.rb','.php','.c','.cpp','.h',
}
MAX_FILE_BYTES = 150_000   # skip files > 150 KB
MAX_TOTAL_CHARS = 180_000  # stay inside ~60k token context

SYSTEM_PROMPT = """You are an expert AI software engineer. You have full access to the user's project files.
Your goal is to satisfy the user's request by modifying the files using precise search-and-replace blocks.

When making code changes, you MUST use the following format exactly.
You can use multiple blocks to modify multiple files or multiple parts of the same file.

```diff
--- relative/path/to/file.ext
+++ relative/path/to/file.ext
@@ -... +... @@
</search_block>
<replace_block>
[exact lines to replace them with]
</replace_block>
```

Rules for patches:
1. The `<search_block>` MUST MATCH the original file exactly, including whitespace and indentation!
2. Include enough context lines in the search block to make it uniquely identifiable in the file.
3. If you are creating a NEW file, use an empty search block.
4. If you are DELETING a file, use an empty replace block.
5. Do not output the entire file content, ONLY the sections that need changing!
6. After your blocks, briefly explain what you changed.

You can also run bash commands in the user's terminal to inspect the project.
If you need to run a command (e.g. `ls -la` or `npm test`), output it like this:

<<<EXECUTE
npm run build
>>>

You can also browse the web to look up documentation or search for solutions.
If you need to search the web, output:
<<<SEARCH
how to install react router
>>>

If you need to fetch a specific webpage and read its content, output:
<<<BROWSE
https://reactrouter.com/docs
>>>

The user's environment will execute these tools, and the output will be returned to you in your next turn.
You can use these blocks freely to figure out what you need to do before writing patches.

Make the changes immediately and completely."""

def backup_project_git(project_path: str, msg: str = "AiderWeb auto-commit before AI edits"):
    """Auto-commit current state if it's a git repo, so changes can be undone."""
    p = Path(project_path)
    if not (p / ".git").exists():
        return False
    # Stage all and commit
    import subprocess
    subprocess.run(["git", "add", "."], cwd=project_path, capture_output=True)
    res = subprocess.run(["git", "commit", "-m", msg], cwd=project_path, capture_output=True)
    return res.returncode == 0

def read_project_files(project_path: str, explicit_files: list[str] = None) -> tuple[str, list[str]]:
    """Read explicitly selected files, or all text files if none selected."""
    p = Path(project_path)
    files_content = []
    file_list = []
    total_chars = 0
    all_files = []

    if explicit_files:
        for f_path in explicit_files:
            f = p / f_path
            if f.exists() and f.is_file():
                all_files.append(f)
    else:
        # Priority order: config files first, then src files, then others
        for f in p.rglob("*"):
            if not f.is_file(): continue
            if any(s in f.parts for s in SKIP): continue
            if f.name.startswith('.'): continue
            if f.suffix.lower() not in TEXT_EXTS: continue
            try:
                size = f.stat().st_size
                if size > MAX_FILE_BYTES: continue
                if size == 0: continue
            except: continue
            all_files.append(f)

    # Sort: config/root files first, then by path depth, then alphabetically
    def sort_key(f):
        rel = str(f.relative_to(p))
        depth = rel.count('/')
        is_config = f.suffix in ('.json', '.toml', '.yml', '.yaml', '.env', '.md')
        is_root = depth == 0
        return (0 if is_root else 1, 0 if is_config else 1, depth, rel)

    all_files.sort(key=sort_key)

    for f in all_files:
        if total_chars >= MAX_TOTAL_CHARS:
            break
        try:
            content = f.read_text(encoding="utf-8", errors="replace")
            rel = str(f.relative_to(p)).replace("\\", "/")
            
            # Smart Trimming: If a file is huge and not explicitly selected, 
            # we just show its skeleton (imports/classes/defs) using Tree-Sitter AST if available.
            if not explicit_files and len(content) > 30000 and f.suffix in ['.py', '.js', '.jsx', '.ts', '.tsx']:
                skeleton_lines = []
                if TS_AVAILABLE:
                    try:
                        ext_map = {'.py': 'python', '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'tsx'}
                        lang_name = ext_map.get(f.suffix)
                        if lang_name:
                            parser = get_parser(lang_name)
                            tree = parser.parse(content.encode('utf-8'))
                            
                            def walk(node, depth=0):
                                # Only grab structural nodes (functions, classes, methods, imports)
                                structural_types = {
                                    'class_definition', 'function_definition', 'method_definition', 
                                    'import_statement', 'import_from_statement', 'export_statement',
                                    'class_declaration', 'function_declaration', 'method_definition'
                                }
                                if node.type in structural_types:
                                    # Get the first line of the node (the signature)
                                    start_line = node.start_point[0]
                                    sig = content.split('\n')[start_line].strip()
                                    skeleton_lines.append("  " * depth + sig + " ...")
                                    
                                for child in node.children:
                                    # Don't walk into the body of functions to save time
                                    if child.type not in ('block', 'statement_block'):
                                        walk(child, depth + (1 if node.type in structural_types else 0))
                                        
                            walk(tree.root_node)
                    except Exception as e:
                        print(f"Tree-sitter error on {f}: {e}")
                
                # Fallback to regex if TS fails or isn't installed
                if not skeleton_lines:
                    lines = content.split('\n')
                    skeleton_lines = [l for l in lines if l.strip().startswith(('import ', 'from ', 'class ', 'def ', 'function ', 'export '))]
                
                if skeleton_lines:
                    content = "\n".join(skeleton_lines) + "\n\n... [File truncated: showing AST skeleton only due to size constraints. Use explicit select to load fully.]" 
            
            entry = f"=== FILE: {rel} ===\n{content}\n"
            if total_chars + len(entry) > MAX_TOTAL_CHARS:
                # Include partial note
                files_content.append(f"=== FILE: {rel} === [truncated — file too large]\n")
                break
            files_content.append(entry)
            file_list.append(rel)
            total_chars += len(entry)
        except:
            continue

    return "\n".join(files_content), file_list

def apply_edits(project_path: str, ai_response: str, dry_run=False) -> list[str]:
    """Parse diff patch blocks from AI response. If dry_run=False, writes to disk."""
    import re
    edited = set()
    
    # regex for diff blocks with <search_block> and <replace_block>
    # matches:
    # --- relative/path.py
    # +++ relative/path.py
    # ...
    # <search_block>
    # ...
    # </search_block>
    # <replace_block>
    # ...
    # </replace_block>
    
    file_pattern = re.compile(r'---\s+([^\n]+)\n\+\+\+\s+([^\n]+)\n.*?(?=<search_block>)', re.DOTALL)
    blocks_pattern = re.compile(r'<search_block>\n?(.*?)\n?</search_block>\s*<replace_block>\n?(.*?)\n?</replace_block>', re.DOTALL)
    
    # Split response by `--- ` to process per file
    parts = ai_response.split('--- ')
    
    for part in parts[1:]:
        part = '--- ' + part
        file_match = file_pattern.search(part)
        if not file_match:
            continue
            
        rel_path = file_match.group(2).strip()
        abs_path = Path(project_path) / rel_path
        
        # Read existing content if file exists
        file_content = ""
        if abs_path.exists():
            try:
                file_content = abs_path.read_text(encoding="utf-8")
            except:
                continue
                
        # Apply all blocks for this file
        for block_match in blocks_pattern.finditer(part):
            search_text = block_match.group(1)
            replace_text = block_match.group(2)
            
            # If search block is empty, we are creating a new file
            if not search_text.strip():
                file_content = replace_text
            # If replace block is empty, we are deleting the file (or emptying it)
            elif not replace_text.strip() and search_text in file_content:
                 file_content = file_content.replace(search_text, "")
            # Normal search and replace
            elif search_text in file_content:
                 file_content = file_content.replace(search_text, replace_text)
            else:
                 # Search text not found, try stripping leading/trailing whitespace
                 if search_text.strip() in file_content:
                     file_content = file_content.replace(search_text.strip(), replace_text.strip())
        
        if not dry_run:
            try:
                abs_path.parent.mkdir(parents=True, exist_ok=True)
                abs_path.write_text(file_content, encoding="utf-8")
                edited.add(rel_path)
            except Exception as e:
                pass
        else:
            edited.add(rel_path)
            
    return list(edited)

# Cache pending diffs in memory { websocket_id -> { project_path, diff_content, test_cmd } }
PENDING_DIFFS = {}

def strip_edits(response: str) -> str:
    """Remove diff code blocks from response for clean display."""
    import re
    clean = re.sub(r'```diff.*?```\n?', '', response, flags=re.DOTALL)
    return clean.strip()


# ── Agent WebSocket ────────────────────────────
@app.websocket("/ws/agent")
async def agent_ws(ws: WebSocket):
    await ws.accept()
    stop_flag = asyncio.Event()

    async def send(type_, **kwargs):
        try:
            await ws.send_text(json.dumps({"type": type_, **kwargs}))
        except:
            pass

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)

            if msg["type"] == "stop":
                stop_flag.set()
                await send("stopped")
                continue

            if msg["type"] == "cmd":
                cwd = msg.get("cwd", str(Path.home()))
                await send("agent_event", event="cmd", text=f"⚡ Running: {msg['cmd']}")
                try:
                    result = subprocess.run(
                        msg["cmd"], shell=True, cwd=cwd,
                        capture_output=True, text=True, timeout=60
                    )
                    await send("cmd_result",
                               output=result.stdout + result.stderr,
                               success=result.returncode == 0)
                except subprocess.TimeoutExpired:
                    await send("cmd_result", output="Timed out after 60s", success=False)
                except Exception as e:
                    await send("cmd_result", output=str(e), success=False)
                continue

            if msg["type"] == "approve":
                wid = id(ws)
                if wid in PENDING_DIFFS:
                    pd = PENDING_DIFFS[wid]
                    # Step 1: Backup project to git before edits
                    backed_up = await asyncio.to_thread(backup_project_git, pd["path"])
                    if backed_up:
                        await send("agent_event", event="cmd", text=f"💾 Saved a git backup of the project before edits")
                        
                    # Write to disk
                    edited_files = await asyncio.to_thread(apply_edits, pd["path"], pd["content"], False)
                    
                    # Agentic Loop
                    agent_loop_result = ""
                    test_cmd = pd["test_cmd"]
                    if test_cmd and edited_files:
                        await send("agent_event", event="cmd", text=f"⚡ Auto-running test command: {test_cmd}")
                        try:
                            res = subprocess.run(
                                test_cmd, shell=True, cwd=pd["path"],
                                capture_output=True, text=True, timeout=120
                            )
                            if res.returncode == 0:
                                agent_loop_result = "\n✅ Tests passed!"
                                await send("agent_event", event="done", text="✅ Tests passed!")
                            else:
                                output = res.stdout + res.stderr
                                agent_loop_result = f"\n❌ Command failed. Output:\n```\n{output[:1000]}...\n```"
                                await send("agent_event", event="error", text="❌ Command failed")
                        except Exception as e:
                            agent_loop_result = f"\n❌ Failed to run command: {e}"
                            await send("agent_event", event="error", text=f"❌ Failed to run command: {e}")
                            
                    summary = f"✅ Edited {len(edited_files)} file(s): {', '.join(edited_files[:5])}{agent_loop_result}"
                    if not test_cmd or (test_cmd and not agent_loop_result.startswith("\n❌")):
                        await send("agent_event", event="done", text=summary)
                    
                    await send("done", edited_files=edited_files, loop_result=agent_loop_result, status="approved")
                    del PENDING_DIFFS[wid]
                continue

            if msg["type"] == "reject":
                wid = id(ws)
                if wid in PENDING_DIFFS:
                    del PENDING_DIFFS[wid]
                    await send("agent_event", event="done", text="❌ Changes rejected by user.")
                    await send("done", edited_files=[], loop_result="", status="rejected")
                continue

            if msg["type"] != "run":
                continue

            # ── Main agent run ─────────────────
            stop_flag.clear()
            project_path = msg["path"]
            model        = msg.get("model", DEFAULT_MODEL).replace("ollama/", "")
            message      = msg["message"]

            await send("agent_event", event="start", text=f"🤖 Starting with {model}...")
            await send("agent_event", event="scan",  text=f"📂 Reading project: {Path(project_path).name}")

            # Step 1: Read selected files or all files
            selected_files = msg.get("selected_files", [])
            
            # Load project memory
            import hashlib
            hashed = hashlib.md5(project_path.encode()).hexdigest()
            mem_file = SETTINGS_FILE.parent / f"memory_{hashed}.json"
            project_memory = []
            if mem_file.exists():
                try: project_memory = json.loads(mem_file.read_text())
                except: pass
                
            # Read Settings for custom Prompt
            settings = {}
            if SETTINGS_FILE.exists():
                try: settings = json.loads(SETTINGS_FILE.read_text())
                except: pass
            
            sys_prompt = settings.get("system_prompt", DEFAULT_SYSTEM_PROMPT)
            if project_memory:
                sys_prompt += "\n\n# MEMORY (Learned facts from previous sessions):\n"
                for i, mem in enumerate(project_memory):
                    sys_prompt += f"{i+1}. {mem}\n"
                sys_prompt += "\nYou can update memory by outputting <<<REMEMBER\nFact to save\n>>>" 
            files_context, file_list = await asyncio.to_thread(read_project_files, project_path, selected_files)

            await send("agent_event", event="scan",
                text=f"📋 Loaded {len(file_list)} files into context")
            await send("agent_event", event="think",
                text=f"🧠 Sending {len(files_context):,} chars to {model}...")

            # Step 3: Build messages for Ollama
            # Include dropped files into context
            extra_files = msg.get("extra_files", [])
            images_b64 = []
            if extra_files:
                files_context += "\n=== EXPLICITLY UPLOADED FILES ===\n"
                for f in extra_files:
                    if f["type"] == "text":
                        files_context += f"=== UPLOADED FILE: {f['name']} ===\n{f['content']}\n"
                    elif f["type"] == "image":
                        images_b64.append(f["content"])
                        files_context += f"=== UPLOADED IMAGE: {f['name']} (attached as vision context) ===\n"

            user_content = f"{files_context}\n\n---\nUSER REQUEST: {message}"
            
            user_message = {"role": "user", "content": user_content}
            if images_b64:
                user_message["images"] = images_b64

            ollama_messages = [
                {"role": "system",    "content": sys_prompt},
                user_message,
            ]
            
            # Token Budget calculation
            token_count = 0
            if TIKTOKEN_AVAILABLE:
                try:
                    enc = tiktoken.get_encoding("cl100k_base")
                    token_count += len(enc.encode(sys_prompt))
                    token_count += len(enc.encode(user_content))
                except: pass
            
            await send("agent_event", event="think", text=f"📊 Token Budget: ~{token_count:,} / 128,000 max context")

            # Step 3: Send to Model Provider
            full_response = ""
            current_chunk = ""
            
            # Helper to stream chunks
            async def handle_chunk(token):
                nonlocal full_response, current_chunk
                if not token: return
                full_response += token
                current_chunk += token
                if len(current_chunk) > 50 or '\n' in current_chunk:
                    display = strip_edits(current_chunk)
                    if display:
                        await send("chunk", text=display)
                    current_chunk = ""
                if "</replace_block>" in full_response:
                    newly_edited = await asyncio.to_thread(apply_edits, project_path, full_response, True)
                    for f in newly_edited:
                        await send("agent_event", event="edit", text=f"✏️ Proposed edit: {f}")

            try:
                # Get API keys from settings
                settings = {}
                if SETTINGS_FILE.exists():
                    try: settings = json.loads(SETTINGS_FILE.read_text())
                    except: pass

                elif model == "gpt-4o-proxy":
                    # OpenAI API
                    api_key = settings.get("openai_key")
                    if not api_key:
                        raise Exception("OpenAI API Key not found in Settings.")
                    client = openai.AsyncOpenAI(api_key=api_key)
                    
                    openai_msgs = [{"role": "system", "content": sys_prompt}]
                    user_msg = {"role": "user", "content": [{"type": "text", "text": user_content}]}
                    if images_b64:
                        for img in images_b64:
                            user_msg["content"].append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}"}})
                    openai_msgs.append(user_msg)
                            
                    stream = await client.chat.completions.create(
                        model="gpt-4o",
                        messages=openai_msgs,
                        temperature=0.1,
                        stream=True
                    )
                    async for chunk in stream:
                        if stop_flag.is_set(): break
                        await handle_chunk(chunk.choices[0].delta.content or "")

                elif model == "claude-3.5-sonnet-proxy":
                    # Anthropic API
                    api_key = settings.get("anthropic_key")
                    if not api_key:
                        raise Exception("Anthropic API Key not found in Settings.")
                    
                    # Claude requires system prompt separated
                    sys_prompt = ollama_messages[0]["content"]
                    user_msg = ollama_messages[1]
                    
                    content_arr = []
                    if "images" in user_msg and user_msg["images"]:
                        for img in user_msg["images"]:
                            content_arr.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img}})
                    content_arr.append({"type": "text", "text": user_msg["content"]})
                    
                    client = Anthropic(api_key=api_key)
                    # Anthropic python sdk stream is synchronous, we run it in thread
                    def run_anthropic():
                        # Simple synchronous call because async stream from sync is tricky in this loop
                        response = client.messages.create(
                            model="claude-3-5-sonnet-20241022",
                            max_tokens=8192,
                            system=sys_prompt,
                            messages=[{"role": "user", "content": user_msg["content"]}], # Vision unsupported in this quick mock
                        )
                        return response.content[0].text
                    text = await asyncio.to_thread(run_anthropic)
                    await handle_chunk(text)

                else:
                    # Ollama API
                    ollama_model = model.replace("ollama/", "")
                    payload = json.dumps({
                        "model":    ollama_model,
                        "messages": ollama_messages,
                        "stream":   True,
                        "options":  {"temperature": 0.1, "num_predict": 8192},
                    }).encode()
                    import urllib.request as req
                    request = req.Request("http://localhost:11434/api/chat", data=payload, headers={"Content-Type": "application/json"}, method="POST")

                    with req.urlopen(request, timeout=300) as response:
                        for line in response:
                            if stop_flag.is_set(): break
                            line = line.decode("utf-8", errors="replace").strip()
                            if not line: continue
                            try:
                                chunk_data = json.loads(line)
                                await handle_chunk(chunk_data.get("message", {}).get("content", ""))
                                if chunk_data.get("done"): break
                            except json.JSONDecodeError: continue

            except Exception as e:
                await send("agent_event", event="error", text=f"⚠️ Model error: {str(e)}")
                await send("done", edited_files=[])
                continue

            # Flush any remaining chunk
            if current_chunk:
                display = strip_edits(current_chunk)
                if display:
                    await send("chunk", text=display)

            # Dry run to find all proposed edits
            edited_files = await asyncio.to_thread(apply_edits, project_path, full_response, True)

            # --- Check if AI wants to execute a command, search, or browse ---
            agent_loop_result = ""
            
            # Web Search Tool
            search_match = re.search(r'<<<SEARCH\n(.*?)\n>>>', full_response, re.DOTALL)
            if search_match:
                query = search_match.group(1).strip()
                await send("agent_event", event="think", text=f"🔍 Searching web: {query}")
                try:
                    from duckduckgo_search import DDGS
                    results = DDGS().text(query, max_results=5)
                    out = "\n".join([f"- {r['title']} ({r['href']})\n  {r['body']}" for r in results])
                    agent_loop_result = f"\n[Web Search Results for '{query}']:\n{out}"
                    await send("agent_event", event="done", text=f"✅ Search completed")
                except Exception as e:
                    agent_loop_result = f"\n❌ Failed to search: {e}"
                    await send("agent_event", event="error", text=f"❌ Search failed")
            
            # Web Browse Tool
            browse_match = re.search(r'<<<BROWSE\n(.*?)\n>>>', full_response, re.DOTALL)
            if browse_match and not agent_loop_result:
                url = browse_match.group(1).strip()
                await send("agent_event", event="think", text=f"🌐 Browsing: {url}")
                try:
                    from bs4 import BeautifulSoup
                    import urllib.request as urllib_req
                    req = urllib_req.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                    html = urllib_req.urlopen(req, timeout=10).read()
                    soup = BeautifulSoup(html, 'html.parser')
                    text = soup.get_text(separator=' ', strip=True)
                    agent_loop_result = f"\n[Webpage Content from '{url}']:\n```\n{text[:3000]}\n```"
                    await send("agent_event", event="done", text=f"✅ Browsing completed")
                except Exception as e:
                    agent_loop_result = f"\n❌ Failed to browse: {e}"
                    await send("agent_event", event="error", text=f"❌ Browsing failed")

            # Terminal Tool
            exec_match = re.search(r'<<<EXECUTE\n(.*?)\n>>>', full_response, re.DOTALL)
            if exec_match and not agent_loop_result:
                cmd_to_run = exec_match.group(1).strip()
                await send("agent_event", event="cmd", text=f"⚡ AI Executing: {cmd_to_run}")
                try:
                    res = subprocess.run(
                        cmd_to_run, shell=True, cwd=project_path,
                        capture_output=True, text=True, timeout=60
                    )
                    out = (res.stdout + res.stderr).strip()
                    if not out: out = "[Command succeeded with no output]"
                    agent_loop_result = f"\n[Terminal Output for '{cmd_to_run}']:\n```\n{out[:2000]}\n```"
                    await send("agent_event", event="done", text=f"✅ Command executed")
                except Exception as e:
                    agent_loop_result = f"\n❌ Failed to run command: {e}"
                    await send("agent_event", event="error", text=f"❌ Failed to run command: {e}")

            if edited_files and not agent_loop_result:
                # Store pending diffs and wait for user approval
                PENDING_DIFFS[id(ws)] = {
                    "path": project_path,
                    "content": full_response,
                    "test_cmd": msg.get("test_cmd", "").strip()
                }
                await send("agent_event", event="think", text=f"⏳ Waiting for user to approve {len(edited_files)} file changes...")
                await send("pending_approval", edited_files=edited_files)
            else:
                summary = "✅ Terminal command finished" if agent_loop_result else "✅ Done"
                await send("agent_event", event="done", text=summary)
                await send("done", edited_files=[], loop_result=agent_loop_result, status="direct")

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try: await send("error", text=str(e))
        except: pass


# ── Terminal WebSocket ─────────────────────────
@app.websocket("/ws/terminal")
async def terminal_ws(ws: WebSocket):
    await ws.accept()
    proc = None
    try:
        init  = json.loads(await ws.receive_text())
        cwd   = init.get("cwd", str(Path.home()))
        shell = "powershell.exe" if sys.platform == "win32" else "bash"

        proc = await asyncio.create_subprocess_exec(
            shell,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
        )

        await ws.send_text(json.dumps({"type": "ready"}))

        async def stream():
            while True:
                data = await proc.stdout.read(2048)
                if not data:
                    break
                await ws.send_text(json.dumps({
                    "type": "output",
                    "text": data.decode("utf-8", errors="replace")
                }))
        asyncio.create_task(stream())

        while True:
            msg = json.loads(await ws.receive_text())
            if msg["type"] == "input" and proc.stdin:
                proc.stdin.write(msg["text"].encode())
                await proc.stdin.drain()

    except WebSocketDisconnect:
        if proc:
            try: proc.kill()
            except: pass
    except Exception as e:
        try: await ws.send_text(json.dumps({"type": "error", "text": str(e)}))
        except: pass


# ── Register routers ───────────────────────────
app.include_router(fs)
app.include_router(proj)
app.include_router(git)
app.include_router(mdl)
app.include_router(scan)
app.include_router(upload)

# ── Serve built frontend ───────────────────────
frontend = Path(__file__).parent.parent / "frontend" / "dist"
if frontend.exists():
    app.mount("/", StaticFiles(directory=str(frontend), html=True), name="static")

if __name__ == "__main__":
    ip = get_ip()
    print("\n" + "="*52)
    print("  AiderWeb — Cloud AI Coding")
    print(f"  Local:    http://localhost:8000")
    print(f"  Network:  http://{ip}:8000  ← phone/other PC")
    print("="*52 + "\n")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False, log_level="warning")
