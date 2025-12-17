// Test browser launch to verify Puppeteer configuration
import { scraper } from './src/services/scraper.js';

async function testBrowserLaunch() {
  console.log('🧪 Testing browser launch...\n');
  
  try {
    console.log('Initializing browser...');
    await scraper.init();
    console.log('✅ Browser initialized successfully!\n');
    
    console.log('Testing page creation...');
    const page = await scraper.browser.newPage();
    console.log('✅ Page created successfully!\n');
    
    console.log('Testing navigation...');
    await page.goto('https://www.example.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
    const title = await page.title();
    console.log(`✅ Navigation successful! Page title: "${title}"\n`);
    
    await page.close();
    await scraper.close();
    console.log('✅ Browser closed successfully!\n');
    console.log('🎉 All tests passed! Browser configuration is working correctly.\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\nError details:', error);
    
    try {
      await scraper.close();
    } catch (closeError) {
      // Ignore close errors
    }
    
    process.exit(1);
  }
}

testBrowserLaunch();

