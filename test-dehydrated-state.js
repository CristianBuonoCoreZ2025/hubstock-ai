async function examineDehydratedState() {
  const res = await fetch('https://www.jumbo.cl/despensa', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html',
    }
  });
  const html = await res.text();
  
  // Find all script tags with dehydratedState
  const scripts = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    const text = match[1].trim();
    if (text.includes('dehydratedState')) {
      try {
        const parsed = JSON.parse(text);
        const queries = parsed?.dehydratedState?.queries;
        if (Array.isArray(queries)) {
          console.log('Number of queries:', queries.length);
          for (let i = 0; i < Math.min(queries.length, 3); i++) {
            const q = queries[i];
            console.log(`\nQuery ${i}:`);
            console.log('  queryKey:', JSON.stringify(q?.queryHash || q?.queryKey).slice(0, 200));
            console.log('  state data keys:', Object.keys(q?.state?.data || {}));
            
            // Check if there's pagination info
            const data = q?.state?.data;
            if (data?.productSearch?.pagination) {
              console.log('  Pagination:', JSON.stringify(data.productSearch.pagination));
            }
            if (data?.productSearch?.products) {
              console.log('  Products:', data.productSearch.products.length);
            }
          }
        }
      } catch (e) {
        console.log('Error parsing script:', e.message);
      }
    }
  }
  
  // Look for __RUNTIME__
  const runtimeMatch = html.match(/window\.__RUNTIME__\s*=\s*({.*?});/);
  if (runtimeMatch) {
    try {
      const runtime = JSON.parse(runtimeMatch[1]);
      console.log('\n__RUNTIME__ keys:', Object.keys(runtime));
      if (runtime?.route?.canonicalPath) {
        console.log('Canonical path:', runtime.route.canonicalPath);
      }
      if (runtime?.route?.matchedPath) {
        console.log('Matched path:', runtime.route.matchedPath);
      }
    } catch (e) {
      console.log('Error parsing __RUNTIME__');
    }
  }
}

examineDehydratedState();
