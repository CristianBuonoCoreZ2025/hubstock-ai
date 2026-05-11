#!/usr/bin/env python3
"""Process raw category data into structured format for the scraper."""
import json
from urllib.parse import urlparse

# Raw data from browser extraction (will be loaded from file)
import sys

def process_categories(raw_data):
    """Convert flat subcategory lists into grouped structure."""
    structured = {}
    
    for cat_name, cat_data in raw_data.items():
        structured[cat_name] = {
            "categoryUrl": cat_data.get("categoryUrl", ""),
            "subcategories": {}
        }
        
        subcats = cat_data.get("subcategories", [])
        for subcat in subcats:
            name = subcat["name"]
            url = subcat["url"]
            
            # Parse URL to get subcategory group
            path_parts = urlparse(url).path.split("/")
            # /browse/belleza/perfumes-y-fragancias/Hombre/70159643_96116047_64620444
            # parts: ['', 'browse', 'belleza', 'perfumes-y-fragancias', 'Hombre', '70159643_...']
            if len(path_parts) >= 4:
                subcat_group = path_parts[3]  # e.g., 'perfumes-y-fragancias'
            else:
                subcat_group = "general"
            
            if subcat_group not in structured[cat_name]["subcategories"]:
                structured[cat_name]["subcategories"][subcat_group] = []
            
            structured[cat_name]["subcategories"][subcat_group].append({
                "name": name,
                "url": url
            })
    
    return structured

if __name__ == "__main__":
    with open("/home/ubuntu/lider_scraper/raw_categories.json", "r", encoding="utf-8") as f:
        raw = json.load(f)
    
    structured = process_categories(raw)
    
    with open("/home/ubuntu/lider_scraper/categories_data.json", "w", encoding="utf-8") as f:
        json.dump(structured, f, ensure_ascii=False, indent=2)
    
    # Print summary
    total_urls = 0
    for cat_name, cat_data in structured.items():
        subcats = cat_data["subcategories"]
        urls = sum(len(items) for items in subcats.values())
        total_urls += urls
        print(f"{cat_name}: {len(subcats)} subcategorías, {urls} URLs")
    
    print(f"\nTotal: {len(structured)} categorías, {total_urls} URLs de subcategorías")
