# Complete Notion API Guide — Neo's Learnings for Claude Code

## Overview
Everything I've learned about Notion API from working with Joy task board and scripts. Use this to understand, debug, and extend Notion integrations.

---

## 1. Core Setup

### Authentication
```bash
# Store API key safely
mkdir -p ~/.config/notion
echo "ntn_your_key_here" > ~/.config/notion/api_key

# Retrieve in scripts
NOTION_KEY=$(cat ~/.config/notion/api_key)
```

### Headers (CRITICAL)
```bash
-H "Authorization: Bearer $NOTION_KEY"
-H "Notion-Version: 2025-09-03"      # MUST match your API version
-H "Content-Type: application/json"
```

**Why version matters:** The 2025-09-03 version introduced "Data Sources" (databases are now called data sources in the API). Using wrong version causes mysterious errors.

---

## 2. IDs & Database Structure

### Two Types of Database IDs
When you search for a database, you get:
- **`database_id`** (UUID) — Used when creating pages (parent reference)
- **`data_source_id`** (UUID) — Used when querying/filtering databases

**Example from Joy task board:**
```
database_id: 37e9a9f0-ff6a-42d6-a6f4-fdd46389acd2
data_source_id: 74bfb6cb-c769-4121-b1ec-887b2765d625
```

### Which ID to Use Where
| Operation | Which ID |
|-----------|----------|
| Create page in database | `database_id` in `parent` |
| Query/filter database | `data_source_id` in URL |
| Get database properties | `database_id` in URL |
| Search for database | Both returned in search results |

**Critical bug:** Using `database_id` in query endpoints returns "multiple data sources" error. Always use `data_source_id` for queries.

---

## 3. Database Queries

### Search for Database
```bash
curl -X POST "https://api.notion.com/v1/search" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{"query": "Joy Task Board", "filter": {"value": "database"}}'
```

Response includes:
```json
{
  "object": "data_source",
  "id": "74bfb6cb-c769-4121-b1ec-887b2765d625",
  "database": {
    "properties": {
      "Task name": {"id": "title", "type": "title"},
      "Status": {"id": "prop123", "type": "select"},
      "DEV | MR": {"id": "prop456", "type": "relation"},
      ...
    }
  }
}
```

### Query/Filter Database
```bash
curl -X POST "https://api.notion.com/v1/data_sources/74bfb6cb-c769-4121-b1ec-887b2765d625/query" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "and": [
        {"property": "Status", "select": {"equals": "Doing"}},
        {"property": "Priority", "select": {"equals": "High"}}
      ]
    },
    "sorts": [
      {"property": "Last edited time", "direction": "descending"}
    ],
    "page_size": 100
  }'
```

### Filter Operators by Property Type

**Select/Multi-select:**
```json
{"property": "Status", "select": {"equals": "Done"}}
{"property": "Labels", "multi_select": {"contains": "urgent"}}
```

**Text/Title:**
```json
{"property": "Task name", "title": {"contains": "bug"}}
{"property": "Description", "rich_text": {"starts_with": "TODO:"}}
```

**Date:**
```json
{"property": "Due date", "date": {"on_or_after": "2026-04-06"}}
{"property": "Due date", "date": {"past_week": {}}}
```

**Checkbox:**
```json
{"property": "Is urgent", "checkbox": {"equals": true}}
```

**Relation:**
```json
{"property": "DEV | MR", "relation": {"contains": "page_id"}}
```

**Number:**
```json
{"property": "Priority", "number": {"greater_than": 5}}
```

---

## 4. Creating & Updating Pages

### Create Page in Database
```bash
curl -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"database_id": "37e9a9f0-ff6a-42d6-a6f4-fdd46389acd2"},
    "properties": {
      "Task name": {
        "title": [{"text": {"content": "Fix Apple Wallet notification"}}]
      },
      "Status": {
        "select": {"name": "To review"}
      },
      "Priority": {
        "select": {"name": "High"}
      },
      "Labels": {
        "multi_select": [{"name": "wallet"}, {"name": "ios"}]
      },
      "Due date": {
        "date": {"start": "2026-04-10"}
      }
    }
  }'
```

**Response:**
```json
{
  "id": "new_page_id",
  "url": "https://notion.so/new_page_id...",
  "properties": {...}
}
```

### Update Page Properties
```bash
curl -X PATCH "https://api.notion.com/v1/pages/page_id" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "properties": {
      "Status": {"select": {"name": "Done"}},
      "Labels": {"multi_select": [{"name": "deployed"}]}
    }
  }'
```

---

## 5. Property Types & Formats

### Common Properties (Joy Task Board)

**Title (required for items):**
```json
"Task name": {"title": [{"text": {"content": "New task"}}]}
```

**Rich Text:**
```json
"Description": {"rich_text": [{"text": {"content": "Task description"}}]}
```

**Select (single choice):**
```json
"Status": {"select": {"name": "Doing"}}
```

**Multi-Select (multiple choices):**
```json
"Labels": {"multi_select": [{"name": "high-priority"}, {"name": "wallet"}]}
```

**Date:**
```json
"Due date": {"date": {"start": "2026-04-10", "end": "2026-04-12"}}
"Due date": {"date": {"start": "2026-04-10"}}  // Single day
```

**Checkbox:**
```json
"Is urgent": {"checkbox": true}
```

**Number:**
```json
"Priority": {"number": 1}
```

**URL:**
```json
"MR link": {"url": "https://gitlab.com/avada/joy/-/merge_requests/4091"}
```

**Email:**
```json
"Contact": {"email": "anhnt@avada.io"}
```

**Relation (link to other database items):**
```json
"DEV | MR": {"relation": [{"id": "page_id_1"}, {"id": "page_id_2"}]}
```

**Rollup (aggregate from related items):**
```json
"MR Status": {"rollup": "..."}  // Read-only, computed by Notion
```

---

## 6. Working with Page Content (Blocks)

### Get Page Content
```bash
curl "https://api.notion.com/v1/blocks/page_id/children" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03"
```

### Add Blocks to Page
```bash
curl -X PATCH "https://api.notion.com/v1/blocks/page_id/children" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "children": [
      {
        "object": "block",
        "type": "paragraph",
        "paragraph": {
          "rich_text": [{"text": {"content": "This is a paragraph"}}]
        }
      },
      {
        "object": "block",
        "type": "heading_2",
        "heading_2": {
          "rich_text": [{"text": {"content": "Section Title"}}]
        }
      },
      {
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": {
          "rich_text": [{"text": {"content": "Item 1"}}]
        }
      }
    ]
  }'
```

**Supported block types:**
- paragraph, heading_1, heading_2, heading_3
- bulleted_list_item, numbered_list_item
- to_do, toggle, quote, callout
- divider, table_of_contents, code, file, image, video, embed, bookmark
- breadcrumb, button, synced_block

---

## 7. Real-World Patterns from Joy

### Pattern: Urgent Task Report
Query all high-priority tasks due within 7 days:

```bash
curl -X POST "https://api.notion.com/v1/data_sources/74bfb6cb-c769-4121-b1ec-887b2765d625/query" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "and": [
        {"property": "Priority", "select": {"equals": "High"}},
        {"property": "Status", "select": {"does_not_equal": "Done"}},
        {"property": "Due date", "date": {"on_or_after": "2026-04-06", "on_or_before": "2026-04-13"}}
      ]
    },
    "sorts": [
      {"property": "Due date", "direction": "ascending"}
    ]
  }'
```

### Pattern: Status Transitions
Update task when it moves to "Launching":

```python
# Python example
import requests
import json

def update_task_status(task_id, new_status, notify_slack=True):
    response = requests.patch(
        f"https://api.notion.com/v1/pages/{task_id}",
        headers={
            "Authorization": f"Bearer {notion_key}",
            "Notion-Version": "2025-09-03"
        },
        json={
            "properties": {
                "Status": {"select": {"name": new_status}}
            }
        }
    )
    
    if notify_slack and new_status in ["Launching", "Done"]:
        # Send Slack notification
        send_slack_alert(task_id, new_status)
    
    return response.json()
```

### Pattern: Link Tasks to Git
Create Notion task and link MR:

```bash
# 1. Create task
RESPONSE=$(curl -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"database_id": "37e9a9f0-ff6a-42d6-a6f4-fdd46389acd2"},
    "properties": {
      "Task name": {"title": [{"text": {"content": "Feature X"}}]},
      "DEV | MR": {"url": "https://gitlab.com/avada/joy/-/merge_requests/4091"}
    }
  }')

TASK_ID=$(echo $RESPONSE | jq -r '.id')
echo "Created task: $TASK_ID"
```

---

## 8. Common Errors & Fixes

### Error: "Multiple data sources with that name"
**Cause:** Using `database_id` instead of `data_source_id` in query endpoint
**Fix:**
```bash
# ❌ Wrong
POST /v1/data_sources/37e9a9f0-ff6a-42d6-a6f4-fdd46389acd2/query

# ✅ Correct
POST /v1/data_sources/74bfb6cb-c769-4121-b1ec-887b2765d625/query
```

### Error: "Invalid `Notion-Version` header"
**Cause:** Using outdated version (e.g., `2021-08-16`)
**Fix:** Always use `2025-09-03` (latest at time of writing)

### Error: 429 Rate Limited
**Cause:** Too many requests (limit ~3/second average)
**Fix:**
```python
import time
if response.status_code == 429:
    retry_after = int(response.headers.get('Retry-After', 1))
    time.sleep(retry_after)
    # Retry request
```

### Error: "Can't create rollup field" or "Property doesn't exist"
**Cause:** Typo in property name or ID
**Fix:** Get database schema first:
```bash
curl "https://api.notion.com/v1/databases/37e9a9f0-ff6a-42d6-a6f4-fdd46389acd2" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" | jq '.database.properties'
```

---

## 9. Best Practices for Claude Code

### Always Start with Schema Discovery
```python
def get_database_schema(database_id):
    """Fetch database schema to understand available properties"""
    response = requests.get(
        f"https://api.notion.com/v1/databases/{database_id}",
        headers={...}
    )
    return response.json()['database']['properties']
```

### Use Pagination for Large Queries
```python
def query_all_items(data_source_id, filter_obj):
    """Query database with pagination"""
    start_cursor = None
    all_items = []
    
    while True:
        body = {"filter": filter_obj, "page_size": 100}
        if start_cursor:
            body["start_cursor"] = start_cursor
        
        response = requests.post(..., json=body)
        items = response.json()['results']
        all_items.extend(items)
        
        if not response.json().get('has_more'):
            break
        
        start_cursor = response.json()['next_cursor']
    
    return all_items
```

### Handle Errors Gracefully
```python
def safe_notion_request(method, url, **kwargs):
    """Wrap Notion API calls with error handling"""
    try:
        response = requests.request(method, url, **kwargs)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 429:
            retry_after = int(e.response.headers.get('Retry-After', 1))
            print(f"Rate limited. Retrying after {retry_after}s...")
            time.sleep(retry_after)
            return safe_notion_request(method, url, **kwargs)
        elif e.response.status_code == 400:
            print(f"Bad request: {e.response.text}")
            return None
        else:
            raise
```

### Map Property Names to IDs
```python
# Instead of using property names, use IDs for reliability
PROPERTY_MAP = {
    "Task name": "title",
    "Status": "prop_xyz123",
    "Due date": "prop_abc456",
    "Labels": "prop_def789"
}

def update_with_safe_properties(page_id, updates):
    """Updates using property IDs instead of names"""
    properties = {}
    for name, value in updates.items():
        prop_id = PROPERTY_MAP[name]
        properties[prop_id] = value
    
    return requests.patch(..., json={"properties": properties})
```

---

## 10. Quick Reference URLs

| Operation | URL |
|-----------|-----|
| Search | `POST /v1/search` |
| Get database schema | `GET /v1/databases/{database_id}` |
| Query database | `POST /v1/data_sources/{data_source_id}/query` |
| Get page | `GET /v1/pages/{page_id}` |
| Create page | `POST /v1/pages` |
| Update page | `PATCH /v1/pages/{page_id}` |
| Get page blocks | `GET /v1/blocks/{page_id}/children` |
| Add blocks | `PATCH /v1/blocks/{page_id}/children` |
| Delete page | `PATCH /v1/pages/{page_id}` (set `archived: true`) |

---

## 11. Joy-Specific Notes

### Joy Task Board Structure
- **Database ID:** `37e9a9f0-ff6a-42d6-a6f4-fdd46389acd2`
- **Data Source ID:** `74bfb6cb-c769-4121-b1ec-887b2765d625`
- **URL:** `https://www.notion.so/avadagroup/37e9a9f0ff6a42d6a6f4fdd46389acd2`

### Key Fields
1. **Task name** (title) — Required
2. **Status** (select) — Values: To review, Doing, Ready, Launching, To deploy, Done
3. **DEV | MR** (relation) — Links to MR pages
4. **Priority** (select) — High, Medium, Low
5. **Labels** (multi-select) — Tags like wallet, instagram, api, etc.
6. **Staging** (text) — Which staging environment (stg-8, stg-9, etc.)

### Status Rules
- **Win (Tech Lead)** — pending for: Doing → To review, To review → Ready
- **Sơn (PO)** — pending for: Ready → Launching, Launching → To deploy
- **QC** — pending for: To deploy → Done

### Automated Alerts
When task status changes to "Launching" or "To deploy" → DM Vitalic on Slack

---

## 12. Python Script Template

```python
#!/usr/bin/env python3
"""
Notion API integration template for Claude Code
"""

import os
import requests
import json
from typing import Dict, List, Optional

class NotionClient:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv('NOTION_API_KEY') or open(os.path.expanduser('~/.config/notion/api_key')).read().strip()
        self.base_url = "https://api.notion.com/v1"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Notion-Version": "2025-09-03",
            "Content-Type": "application/json"
        }
    
    def search(self, query: str, filter_type: str = "database") -> Dict:
        """Search for pages or databases"""
        response = requests.post(
            f"{self.base_url}/search",
            headers=self.headers,
            json={"query": query, "filter": {"value": filter_type}}
        )
        return response.json()
    
    def query_database(self, data_source_id: str, filter_obj: Dict = None, sort_obj: Dict = None) -> List[Dict]:
        """Query database with optional filter and sort"""
        body = {"page_size": 100}
        if filter_obj:
            body["filter"] = filter_obj
        if sort_obj:
            body["sorts"] = sort_obj
        
        response = requests.post(
            f"{self.base_url}/data_sources/{data_source_id}/query",
            headers=self.headers,
            json=body
        )
        return response.json().get('results', [])
    
    def create_page(self, database_id: str, properties: Dict) -> Dict:
        """Create new page in database"""
        response = requests.post(
            f"{self.base_url}/pages",
            headers=self.headers,
            json={"parent": {"database_id": database_id}, "properties": properties}
        )
        return response.json()
    
    def update_page(self, page_id: str, properties: Dict) -> Dict:
        """Update page properties"""
        response = requests.patch(
            f"{self.base_url}/pages/{page_id}",
            headers=self.headers,
            json={"properties": properties}
        )
        return response.json()

# Usage
if __name__ == "__main__":
    notion = NotionClient()
    
    # Search for database
    results = notion.search("Joy Task Board")
    print(json.dumps(results, indent=2))
```

---

## Summary for Claude Code

When working with Notion API:

1. **Always use `data_source_id` for queries**, `database_id` for creating pages
2. **Always specify `Notion-Version: 2025-09-03`** header
3. **Paginate large result sets** (use `page_size` and cursors)
4. **Handle rate limits** with exponential backoff
5. **Cache database schema** to avoid repeated lookups
6. **Test filters locally** before deploying (Notion filters are powerful but finicky)
7. **Use the official Python SDK** when available (requests library for raw HTTP)

Good luck building! 🚀
