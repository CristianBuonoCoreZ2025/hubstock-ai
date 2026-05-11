#!/usr/bin/env python3
"""Extract category data chunks from browser localStorage via a simple approach."""
import json
import sys

# We'll collect all chunks passed as arguments
all_data = {}

for i in range(10):
    filepath = f"/home/ubuntu/lider_scraper/chunk_{i}.json"
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            chunk = json.load(f)
            all_data.update(chunk)
    except FileNotFoundError:
        pass

if all_data:
    with open("/home/ubuntu/lider_scraper/raw_categories.json", 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(all_data)} categories to raw_categories.json")
else:
    print("No chunks found")
