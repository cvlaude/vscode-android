import argparse
import json
import os
import pathlib
import subprocess
import time

##########################################################################

projects = ["example-site", "example-pages", "example-game", "example-portal", "example-engine"]
extensions = {".html", ".htm", ".css", ".scss", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".jsonc", ".csv", ".md", ".txt", ".py", ".cs", ".csproj", ".sln", ".props", ".targets", ".c", ".cpp", ".h", ".hpp", ".toml", ".yml", ".yaml", ".ini", ".xml", ".svg", ".sh", ".ps1", ".lua", ".luau", ".gitignore", ".gitattributes"}
excluded = {".claude", "node_modules", ".git", ".cache", ".gradle", "bin", "obj", "build", "builds", "dist", "distribution", "artifacts", "testresults", "generated", "_framework"}

def refresh(repositories, destination):
    receipts = []
    for name in projects:
        repo = repositories / name
        target = destination / name
        target.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "--exclude=.claude/", "--exclude=node_modules/", "-z"], cwd=repo, capture_output=True, check=True, timeout=60)
        selected = set()
        for relative in dict.fromkeys(result.stdout.decode("utf-8").split("\0")):
            if not relative:
                continue
            path = pathlib.PurePosixPath(relative)
            if any(part.lower() in excluded for part in path.parts):
                continue
            if path.suffix.lower() not in extensions and path.name not in {".gitignore", ".gitattributes", "CNAME", ".nojekyll"}:
                continue
            if path.name.lower().startswith(".env") or path.name.lower() in {"auth.json", "credentials.json"}:
                continue
            filename = repo / relative
            if not filename.is_file() or filename.is_symlink() or filename.stat().st_size > 4 * 1024 * 1024:
                continue
            output = target / relative
            selected.add(path.as_posix())
            output.parent.mkdir(parents=True, exist_ok=True)
            if output.exists() and not os.path.samefile(filename, output):
                recovery = destination.parent / "priorityrecovery" / str(time.time_ns()) / name / relative
                recovery.parent.mkdir(parents=True, exist_ok=True)
                output.replace(recovery)
            if not output.exists():
                os.link(filename, output)
        previous = target / "priority.json"
        if previous.exists():
            for relative in json.loads(previous.read_text()).get("files", []):
                filename = target / relative
                if relative not in selected and filename.is_file():
                    recovery = destination.parent / "priorityrecovery" / str(time.time_ns()) / name / relative
                    recovery.parent.mkdir(parents=True, exist_ok=True)
                    filename.replace(recovery)
        receipt = {"name": name, "source": str(repo), "files": sorted(selected)}
        temporary = previous.with_suffix(".pending")
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(receipt, stream)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(previous)
        receipts.append({"name": name, "files": len(selected)})
    return receipts

##########################################################################

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repositories", type=pathlib.Path, default=pathlib.Path.home() / "Documents/GitHub")
    parser.add_argument("--destination", type=pathlib.Path, required=True)
    parser.add_argument("--watch", action="store_true")
    args = parser.parse_args()
    while True:
        print(json.dumps(refresh(args.repositories, args.destination)), flush=True)
        if not args.watch:
            break
        time.sleep(60)
