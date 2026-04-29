# Personal Layer

Skill và command cá nhân, build trên top của gstack.

## Cấu trúc

- `skills/` — skill cá nhân (prefix `my-` cross-project, `joy-` cho Joy, etc.)
- `commands/` — slash command cá nhân

## Symlink vào ~/.claude/

Mỗi skill mới symlink riêng:

```bash
ln -s ~/Project/github/dotfiles-claude/personal/skills/<skill-name> \
      ~/.claude/skills/<skill-name>
```

## Naming convention

| Prefix | Scope |
|---|---|
| `my-` | Cross-project (mọi dự án) |
| `joy-` | Joy-specific |
| `wkfl-` | Personal workflow |
