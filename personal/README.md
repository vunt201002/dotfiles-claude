# Personal Layer

Skill, command, và reference cá nhân, build trên top của gstack.

## Cấu trúc

```
personal/
├── skills/              # SKILL.md folders, symlink riêng từng skill vào ~/.claude/skills/
│   ├── my-bug-hunter/   # Cross-project: hypothesis-first debug workflow
│   ├── notion-task-personal/    # Cross-project: Joy Notion task board CLI (standalone)
│   ├── joy-frontend-fix/        # Joy-specific: frontend-fix v2 with __joyDebug
│   └── joy-widget-v4-fix/       # Joy-specific: widget v4 4-layer playbook
│       └── references/
│           ├── shadow-dom.md
│           └── css-variable-map.md
├── commands/            # Slash commands, symlink vào ~/.claude/commands/
│   └── joy-batch-fix.md         # Joy-specific: batch fix from Notion
└── docs/                # Reference docs (KHÔNG symlink, đọc khi cần)
    ├── frontend-fix-workflow.md
    └── widget-v4-testing-strategy.md
```

## Symlink mới

### Skill
```bash
ln -s ~/Project/github/dotfiles-claude/personal/skills/<skill-name> \
      ~/.claude/skills/<skill-name>
```

### Command
```bash
ln -s ~/Project/github/dotfiles-claude/personal/commands/<command>.md \
      ~/.claude/commands/<command>.md
```

## Naming convention

| Prefix | Scope |
|---|---|
| `my-` | Cross-project (mọi dự án) |
| `joy-` | Joy-specific |
| `wkfl-` | Personal workflow |

## Setup máy mới

```bash
git clone git@github.com:vunt201002/dotfiles-claude.git ~/Project/github/dotfiles-claude
cd ~/Project/github/dotfiles-claude

# Symlink từng skill cần dùng
for skill in personal/skills/*/; do
  name=$(basename "$skill")
  ln -s "$PWD/$skill" ~/.claude/skills/"$name"
done

# Symlink từng command
mkdir -p ~/.claude/commands
for cmd in personal/commands/*.md; do
  name=$(basename "$cmd")
  ln -s "$PWD/$cmd" ~/.claude/commands/"$name"
done
```
