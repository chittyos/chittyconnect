import urllib.request
import json
import re
import datetime
from html.parser import HTMLParser

BASE_URL = "https://www.cookcountycourtil.gov"
INDEX_URLS = [
    "/about/circuit-court-rules",
    "/general-administrative-rules",
    "/about/general-orders-cook-county-circuit-court",
    "/about/orders"
]

class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.in_a = False
        self.current_href = ""
        self.current_text = ""

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.in_a = True
            for k, v in attrs:
                if k == "href":
                    self.current_href = v

    def handle_endtag(self, tag):
        if tag == "a":
            self.in_a = False
            if self.current_href:
                self.links.append((self.current_href, self.current_text.strip()))
            self.current_href = ""
            self.current_text = ""

    def handle_data(self, data):
        if self.in_a:
            self.current_text += data

class RuleContentParser(HTMLParser):
    def __init__(self, source_url):
        super().__init__()
        self.rules = []
        self.current_rule = None
        self.in_strong = False
        self.current_tag = None
        self.source_url = source_url
        self.last_anchor = None
        self.text_buffer = ""

    def handle_starttag(self, tag, attrs):
        self.current_tag = tag
        if tag == "a":
            for k, v in attrs:
                if k in ("name", "id") and v:
                    self.last_anchor = v
        elif tag == "strong" or tag == "b":
            self.in_strong = True

    def handle_endtag(self, tag):
        if tag == "strong" or tag == "b":
            self.in_strong = False
        if tag in ["p", "div", "li"]:
            text = self.text_buffer.strip()
            self.text_buffer = ""
            if not text:
                return
            
            # Check if this text starts a new rule
            if self.in_strong or re.match(r'^((Rule|Part|General Order|General Administrative Order)\s+)?\d+[\.\w]*\s', text, re.IGNORECASE):
                # Start new rule
                if self.current_rule and self.current_rule["text"].strip():
                    self.rules.append(self.current_rule)
                
                self.current_rule = {
                    "rule_number": text.split(' ')[0] if not text.lower().startswith('rule') else text.split(' ')[1],
                    "heading": text,
                    "text": "",
                    "amendment_effective_date": "",
                    "source_url": self.source_url,
                    "section_anchor": self.last_anchor if self.last_anchor else "",
                    "retrieval_timestamp": datetime.datetime.now().isoformat()
                }
            else:
                if self.current_rule:
                    self.current_rule["text"] += text + "\n\n"
                    
                    if "effective" in text.lower() or "amended" in text.lower():
                        date_match = re.search(r'(?:effective|amended).*?([A-Z][a-z]+ \d{1,2}, \d{4})', text, re.IGNORECASE)
                        if date_match and not self.current_rule["amendment_effective_date"]:
                            self.current_rule["amendment_effective_date"] = date_match.group(1)

    def handle_data(self, data):
        self.text_buffer += data

def fetch(url):
    print(f"Fetching {url}")
    if not url.startswith("http"):
        url = BASE_URL + url
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        return urllib.request.urlopen(req).read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"Failed to fetch {url}: {e}")
        return ""

def main():
    all_rules = []
    visited = set()
    
    subpages = set()
    for idx_url in INDEX_URLS:
        html = fetch(idx_url)
        lp = LinkParser()
        lp.feed(html)
        for href, text in lp.links:
            if href.startswith("/part-") or "rules" in href.lower() or "orders" in href.lower():
                clean_href = href.split('#')[0]
                if clean_href and clean_href not in visited:
                    subpages.add(clean_href)
                    visited.add(clean_href)
    
    for idx_url in INDEX_URLS:
        if idx_url not in visited:
            subpages.add(idx_url)
            visited.add(idx_url)
    
    print(f"Found {len(subpages)} subpages to scrape.")
    
    for page in subpages:
        html = fetch(page)
        rp = RuleContentParser(BASE_URL + page)
        rp.feed(html)
        if rp.current_rule and rp.current_rule["text"].strip():
            rp.rules.append(rp.current_rule)
        
        valid_rules = [r for r in rp.rules if r["text"].strip() and len(r["heading"]) > 3]
        print(f"Extracted {len(valid_rules)} rules from {page}")
        all_rules.extend(valid_rules)
    
    with open("cook_county_corpus.json", "w") as f:
        json.dump(all_rules, f, indent=2)
    print(f"Successfully saved {len(all_rules)} rules to cook_county_corpus.json")

if __name__ == "__main__":
    main()
