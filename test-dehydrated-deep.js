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
          for (let i = 0; i < queries.length; i++) {
            const q = queries[i];
            if (q?.state?.data?.products) {
              console.log(`\n=== Query ${i} ===`);
              console.log('queryKey:', q?.queryHash || q?.queryKey);
              console.log('Number of products:', q.state.data.products.length);
              
              // Check for pagination
              if (q.state.data.results) {
                console.log('Results:', JSON.stringify(q.state.data.results).slice(0, 500));
              }
              
              // Check originalUrl
              if (q.state.data.originalUrl) {
                console.log('Original URL:', q.state.data.originalUrl);
              }
              
              // Check first product for category info
              if (q.state.data.products.length > 0) {
                const p = q.state.data.products[0];
                console.log('First product keys:', Object.keys(p).slice(0, 20));
                console.log('First product name:', p.productName || p.name);
                
                // Check if product has category info
                if (p.categories) {
                  console.log('Categories:', JSON.stringify(p.categories).slice(0, 200));
                }
                if (p.categoryTree) {
                  console.log('Category tree:', JSON.stringify(p.categoryTree).slice(0, 200));
                }
              }
              
              // Check facets for pagination hints
              if (q.state.data.facets) {
                console.log('Facets count:', q.state.data.facets.length);
              }
            }
          }
        }
        
        // Look for mutation cache which might have pagination info
        const mutations = parsed?.dehydratedState?.mutations;
        if (mutations) {
          console.log('\nMutations:', Object.keys(mutations));
        }
      } catch (e) {
        console.log('Error parsing script:', e.message);
      }
    }
  }
}

examineDehydratedState();
