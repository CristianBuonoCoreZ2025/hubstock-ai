async function testRuntime() {
  const res = await fetch('https://www.jumbo.cl/despensa', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html',
    }
  });
  const html = await res.text();
  
  // Look for __RUNTIME__
  const runtimeMatch = html.match(/window\.__RUNTIME__\s*=\s*({.*?});/);
  if (runtimeMatch) {
    try {
      const runtime = JSON.parse(runtimeMatch[1]);
      console.log('__RUNTIME__ keys:', Object.keys(runtime));
      
      if (runtime?.route) {
        console.log('Route:', JSON.stringify(runtime.route).slice(0, 500));
      }
      
      if (runtime?.production) {
        console.log('Production:', runtime.production);
      }
      
      if (runtime?.account) {
        console.log('Account:', runtime.account);
      }
      
      if (runtime?.workspace) {
        console.log('Workspace:', runtime.workspace);
      }
      
      // Look for API endpoint hints
      if (runtime?.appsEtag) {
        console.log('Apps etag:', runtime.appsEtag);
      }
      
      if (runtime?.settings) {
        console.log('Settings keys:', Object.keys(runtime.settings).slice(0, 10));
      }
    } catch (e) {
      console.log('Error parsing __RUNTIME__:', e.message);
    }
  } else {
    console.log('No __RUNTIME__ found');
  }
  
  // Look for __INITIAL_STATE__
  const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/);
  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch[1]);
      console.log('\n__INITIAL_STATE__ keys:', Object.keys(state).slice(0, 20));
    } catch (e) {
      console.log('Error parsing __INITIAL_STATE__');
    }
  }
  
  // Look for API base URLs in the HTML
  const apiMatches = [...html.matchAll(/"(https?:\/\/[^"]*api[^"]*)"/gi)];
  console.log('\nAPI URLs:', [...new Set(apiMatches.map(m => m[1]))].slice(0, 10));
}

testRuntime();
