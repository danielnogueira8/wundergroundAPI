// Test script for current temperature endpoint
// Usage: node test_current_temp.js [API_URL] [location]

const API_URL = process.argv[2] || 'http://localhost:3000';
const location = process.argv[3] || 'gb/london/EGLC';

async function testCurrentTemperature() {
  console.log(`\n🧪 Testing Current Temperature Endpoint\n`);
  console.log(`API URL: ${API_URL}`);
  console.log(`Location: ${location}`);
  console.log(`\nFetching: ${API_URL}/api/weather/latest?location=${encodeURIComponent(location)}\n`);

  try {
    const startTime = Date.now();
    const response = await fetch(`${API_URL}/api/weather/latest?location=${encodeURIComponent(location)}`);
    const duration = Date.now() - startTime;
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Request failed:', response.status, response.statusText);
      console.error('Response:', JSON.stringify(data, null, 2));
      process.exit(1);
    }
    
    if (data.success) {
      console.log('✅ Request successful!\n');
      console.log('📊 Response Data:');
      console.log('─'.repeat(50));
      console.log(`Location: ${data.data.location.city}, ${data.data.location.country}`);
      console.log(`Station: ${data.data.location.station}`);
      console.log(`\n🌡️  Current Temperature:`);
      console.log(`   Celsius: ${data.data.current.temperature.celsius}°C`);
      console.log(`   Fahrenheit: ${data.data.current.temperature.fahrenheit}°F`);
      console.log(`\n⏱️  Metadata:`);
      console.log(`   Timestamp: ${data.data.timestamp}`);
      console.log(`   Scraped at: ${data.metadata.scraped_at}`);
      console.log(`   Cache hit: ${data.metadata.cache_hit ? 'Yes' : 'No'}`);
      console.log(`   Response time: ${data.metadata.response_time_ms}ms`);
      console.log(`   Total duration: ${duration}ms`);
      console.log('─'.repeat(50));
      
      // Validate the temperature is reasonable
      const temp = data.data.current.temperature.celsius;
      if (temp < -50 || temp > 60) {
        console.log('\n⚠️  WARNING: Temperature seems unusual (outside normal range)');
      } else {
        console.log('\n✓ Temperature value looks reasonable');
      }
      
      // Test conversion
      const expectedF = Math.round((temp * 9/5 + 32) * 10) / 10;
      const actualF = data.data.current.temperature.fahrenheit;
      if (Math.abs(expectedF - actualF) > 0.1) {
        console.log(`\n⚠️  WARNING: Fahrenheit conversion might be off`);
        console.log(`   Expected: ${expectedF}°F, Got: ${actualF}°F`);
      } else {
        console.log('✓ Fahrenheit conversion is correct');
      }
      
    } else {
      console.error('❌ API returned success: false');
      console.error('Error:', JSON.stringify(data.error, null, 2));
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.message.includes('fetch')) {
      console.error('\n💡 Make sure the server is running:');
      console.error('   npm start');
      console.error('   or');
      console.error('   docker-compose up');
    }
    process.exit(1);
  }
}

// Run the test
testCurrentTemperature();

