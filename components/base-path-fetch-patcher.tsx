'use client';

import { useEffect } from 'react';

export function BasePathFetchPatcher() {
  useEffect(() => {
    const basePath = '/classroom';
    const originalFetch = window.fetch;
    
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      if (typeof input === 'string' && input.startsWith('/') && !input.includes('://') && !input.startsWith(basePath + '/') && input !== basePath) {
        input = basePath + input;
      }
      return originalFetch(input, init);
    };
    
    return () => { window.fetch = originalFetch; };
  }, []);
  
  return null;
}
