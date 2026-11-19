"""
Deploy Sahay to a Hugging Face Docker Space.

  python scripts/deploy-hf.py            # create/update <user>/sahay and push the committed tree
  python scripts/deploy-hf.py --secrets  # also copy .env values into the Space's secrets

Reads HF_TOKEN and the app's keys from .env itself and never prints a value: only key names.
Uploads exactly the committed files (git archive HEAD), with a Space README front matter.
"""
import io
import os
import subprocess
import sys
import tarfile
import tempfile

from huggingface_hub import HfApi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPACE_NAME = "sahay"
# Set by the image or the Space itself, or not wanted in hosting.
SKIP_KEYS = {"HF_TOKEN", "HOST", "PORT", "DB_FILE", "PUBLIC_URL", "TRUST_FORWARDED_FOR"}

FRONT_MATTER = """---
title: Sahay
emoji: 🛒
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Voice agent that buys for small shops (Agora + Murf)
---

"""


def read_env(path):
    values = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            if value:
                values[key.strip()] = value
    return values


def main():
    env = read_env(os.path.join(ROOT, ".env"))
    token = env.get("HF_TOKEN")
    if not token:
        sys.exit("HF_TOKEN is not set in .env")
    api = HfApi(token=token)
    user = api.whoami()["name"]
    repo_id = f"{user}/{SPACE_NAME}"
    api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True)
    host = f"https://{user.lower().replace('_', '-').replace('.', '-')}-{SPACE_NAME}.hf.space"
    print(f"space {repo_id} -> {host}")

    if "--secrets" in sys.argv:
        names = []
        for key, value in env.items():
            if key in SKIP_KEYS:
                continue
            api.add_space_secret(repo_id, key, value)
            names.append(key)
        api.add_space_variable(repo_id, "PUBLIC_URL", host)
        api.add_space_variable(repo_id, "TRUST_FORWARDED_FOR", "1")
        print("secrets set:", ", ".join(sorted(names)))
        print("variables set: PUBLIC_URL, TRUST_FORWARDED_FOR")

    archive = subprocess.run(["git", "archive", "--format=tar", "HEAD"], cwd=ROOT, capture_output=True, check=True).stdout
    with tempfile.TemporaryDirectory() as tmp:
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(tmp, filter="data")
        readme = os.path.join(tmp, "README.md")
        with open(readme, encoding="utf-8") as fh:
            body = fh.read()
        with open(readme, "w", encoding="utf-8") as fh:
            fh.write(FRONT_MATTER + body)
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        api.upload_folder(folder_path=tmp, repo_id=repo_id, repo_type="space",
                          commit_message=f"Deploy {commit}", delete_patterns=["*"])
    print(f"uploaded commit {commit}; build log: https://huggingface.co/spaces/{repo_id}?logs=build")


if __name__ == "__main__":
    main()
