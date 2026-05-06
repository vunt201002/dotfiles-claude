# Notion Block Formatting Reference

How to write and update page body content using the Notion API.

## API Endpoints

```
# Read page blocks
GET /blocks/{PAGE_ID}/children?page_size=100

# Append blocks to page
PATCH /blocks/{PAGE_ID}/children
Body: { "children": [...blocks] }

# Delete a block
DELETE /blocks/{BLOCK_ID}

# To rewrite page content: delete all blocks first, then append new ones
# Rate limit: 0.5s between batch deletions
```

## Block Types

### Paragraph
```json
{
  "type": "paragraph",
  "paragraph": {
    "rich_text": [{"type": "text", "text": {"content": "Plain text here"}}]
  }
}
```

### Heading 2 / Heading 3
```json
{
  "type": "heading_2",
  "heading_2": {
    "rich_text": [{"type": "text", "text": {"content": "Section Title"}}]
  }
}
```

### Bulleted List
```json
{
  "type": "bulleted_list_item",
  "bulleted_list_item": {
    "rich_text": [{"type": "text", "text": {"content": "List item"}}]
  }
}
```

### To-Do (Checkbox)
```json
{
  "type": "to_do",
  "to_do": {
    "rich_text": [{"type": "text", "text": {"content": "Task item"}}],
    "checked": false
  }
}
```

### Divider
```json
{"type": "divider", "divider": {}}
```

### Code Block
```json
{
  "type": "code",
  "code": {
    "rich_text": [{"type": "text", "text": {"content": "console.log('hello')"}}],
    "language": "javascript"
  }
}
```

### Callout (Info Box)
```json
{
  "type": "callout",
  "callout": {
    "icon": {"type": "emoji", "emoji": "💡"},
    "rich_text": [{"type": "text", "text": {"content": "Important note here"}}]
  }
}
```

### Toggle (Collapsible)
```json
{
  "type": "toggle",
  "toggle": {
    "rich_text": [{"type": "text", "text": {"content": "Click to expand"}}]
  }
}
```

## Rich Text Formatting

### Bold / Italic / Code / Strikethrough
```json
{
  "type": "text",
  "text": {"content": "bold text"},
  "annotations": {"bold": true}
}
```

Available annotations: `bold`, `italic`, `strikethrough`, `underline`, `code`, `color`

### Link
```json
{
  "type": "text",
  "text": {
    "content": "Click here",
    "link": {"url": "https://example.com"}
  }
}
```

**Pitfall:** Don't mix `href` and `link` — use only `link` in the `text` object.

### @Mention (User)
```json
{
  "type": "mention",
  "mention": {
    "user": {"id": "bdda85c7-d04e-42e9-be48-13bc4eb64e98"}
  }
}
```

### @Mention (Page)
```json
{
  "type": "mention",
  "mention": {
    "page": {"id": "PAGE_UUID"}
  }
}
```

### Line Breaks
Use `\n` inside the content string:
```json
{"type": "text", "text": {"content": "Line 1\nLine 2\nLine 3"}}
```

## Common Patterns

### Bug Report Template
```python
blocks = [
    {"type": "heading_2", "heading_2": {"rich_text": [{"type": "text", "text": {"content": "Root Cause"}}]}},
    {"type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": "Description of what went wrong"}}]}},
    {"type": "divider", "divider": {}},
    {"type": "heading_2", "heading_2": {"rich_text": [{"type": "text", "text": {"content": "Timeline"}}]}},
    {"type": "bulleted_list_item", "bulleted_list_item": {"rich_text": [{"type": "text", "text": {"content": "2026-04-01 — Issue first reported"}}]}},
    {"type": "divider", "divider": {}},
    {"type": "heading_2", "heading_2": {"rich_text": [{"type": "text", "text": {"content": "Reproduce"}}]}},
    {"type": "numbered_list_item", "numbered_list_item": {"rich_text": [{"type": "text", "text": {"content": "Step 1"}}]}},
    {"type": "divider", "divider": {}},
    {"type": "heading_2", "heading_2": {"rich_text": [{"type": "text", "text": {"content": "Resolution"}}]}},
    {"type": "to_do", "to_do": {"rich_text": [{"type": "text", "text": {"content": "Fix XYZ in service.js"}}], "checked": False}},
]
```

### Emoji Section Headers
```python
{"type": "heading_2", "heading_2": {"rich_text": [{"type": "text", "text": {"content": "🔍 Root Cause"}}]}}
{"type": "heading_2", "heading_2": {"rich_text": [{"type": "text", "text": {"content": "📅 Timeline"}}]}}
{"type": "heading_2", "heading_2": {"rich_text": [{"type": "text", "text": {"content": "🔄 Reproduce"}}]}}
{"type": "heading_2", "heading_2": {"rich_text": [{"type": "text", "text": {"content": "✅ Resolution"}}]}}
```

### Rewrite Entire Page Content
```python
# 1. Delete existing blocks
blocks = notion_api("GET", f"/blocks/{page_id}/children?page_size=100")
for block in blocks["results"]:
    notion_api("DELETE", f"/blocks/{block['id']}")
    time.sleep(0.5)  # Rate limit

# 2. Append new blocks (max 100 per call)
notion_api("PATCH", f"/blocks/{page_id}/children", {"children": new_blocks})
```

## Limits

- Max 100 blocks per append call
- Rate limit: ~3 requests/sec (add 0.5s delay for batch ops)
- Rich text max length: 2000 characters per text object
- Max 100 items in filter arrays
- Page size max: 100 for queries