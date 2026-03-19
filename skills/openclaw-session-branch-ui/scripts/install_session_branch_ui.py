from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Install the Session Branch UI template and gateway startup hook into an OpenClaw workspace/state directory.'
    )
    parser.add_argument('--workspace', help='OpenClaw workspace path. Defaults to <state-dir>/workspace when omitted.')
    parser.add_argument('--state-dir', help='OpenClaw state dir. Defaults to ~/.openclaw.')
    parser.add_argument('--ui-dir-name', default='session-branch-ui', help='Target UI directory name inside the workspace.')
    parser.add_argument('--hook-name', default='session-branch-ui-autostart', help='Target hook directory name inside the state dir hooks folder.')
    parser.add_argument('--force', action='store_true', help='Overwrite existing target directories.')
    parser.add_argument('--dry-run', action='store_true', help='Print planned actions without writing files.')
    return parser.parse_args()


def default_state_dir() -> Path:
    return Path.home() / '.openclaw'


def resolve_paths(args: argparse.Namespace) -> tuple[Path, Path, Path, Path]:
    state_dir = Path(args.state_dir).expanduser().resolve() if args.state_dir else default_state_dir().resolve()
    workspace = Path(args.workspace).expanduser().resolve() if args.workspace else (state_dir / 'workspace').resolve()
    ui_root = workspace / args.ui_dir_name
    hook_root = state_dir / 'hooks' / args.hook_name
    return state_dir, workspace, ui_root, hook_root


def copy_tree(src: Path, dest: Path, force: bool, dry_run: bool) -> None:
    if dest.exists():
        if not force:
            raise RuntimeError(f'Target already exists: {dest}')
        if not dry_run:
            shutil.rmtree(dest)
    if dry_run:
        print(f'[dry-run] copy {src} -> {dest}')
        return
    shutil.copytree(src, dest)


def patch_hook_file(path: Path, ui_root: Path, dry_run: bool) -> None:
    if dry_run:
        print(f'[dry-run] patch placeholder in {path}')
        return
    text = path.read_text(encoding='utf-8')
    escaped_root = str(ui_root).replace('\\', '\\\\')
    patched = text.replace('__SESSION_BRANCH_UI_ROOT__', escaped_root)
    path.write_text(patched, encoding='utf-8')


def ensure_runtime_files(ui_root: Path, dry_run: bool) -> None:
    branches_file = ui_root / 'data' / 'branches.json'
    logs_dir = ui_root / 'logs'
    if dry_run:
        print(f'[dry-run] ensure {branches_file}')
        print(f'[dry-run] ensure {logs_dir}')
        return
    branches_file.parent.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)
    if not branches_file.exists():
        branches_file.write_text('[]\n', encoding='utf-8')


def main() -> int:
    args = parse_args()
    skill_dir = Path(__file__).resolve().parents[1]
    template_src = skill_dir / 'assets' / 'session-branch-ui-template'
    hook_src = skill_dir / 'assets' / 'session-branch-ui-hook'

    state_dir, workspace, ui_root, hook_root = resolve_paths(args)

    summary = {
        'stateDir': str(state_dir),
        'workspace': str(workspace),
        'uiRoot': str(ui_root),
        'hookRoot': str(hook_root),
        'dryRun': args.dry_run,
        'force': args.force,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    copy_tree(template_src, ui_root, force=args.force, dry_run=args.dry_run)
    copy_tree(hook_src, hook_root, force=args.force, dry_run=args.dry_run)

    for hook_file in ('handler.js', 'handler.source.ts'):
        patch_hook_file(hook_root / hook_file, ui_root, dry_run=args.dry_run)

    ensure_runtime_files(ui_root, dry_run=args.dry_run)

    print('\nNext steps:')
    print(f'1. Restart Gateway so the hook is reloaded: openclaw gateway restart')
    print(f"2. Check UI status: powershell -NoProfile -ExecutionPolicy Bypass -File '{ui_root / 'scripts' / 'status.ps1'}'")
    print('3. Open http://127.0.0.1:4317 after the UI starts')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
