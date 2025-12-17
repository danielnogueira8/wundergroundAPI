// Using native fetch (Node.js 18+)

// Cities that likely have Polymarket markets (based on the pattern)
const cities = [
  { name: 'London', location: 'gb/london/EGLC' },
  { name: 'New York', location: 'us/new-york-city/KLGA' },
  { name: 'Seattle', location: 'us/seatac/KSEA' },
  { name: 'Dallas', location: 'us/dallas/KDAL' },
  { name: 'Atlanta', location: 'us/atlanta/KATL' },
  { name: 'Toronto', location: 'ca/mississauga/CYYZ' },
  { name: 'Seoul', location: 'kr/incheon/RKSI' },
];

const date = '2025-12-18';

// Get API URL from command line argument, environment variable, or default
const args = process.argv.slice(2);
const API_URL = args[0] || process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
  : 'http://localhost:3000';

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
Usage: node check_markets.js [API_URL]

Checks December 18, 2025 temperature data for cities with Polymarket markets.

Arguments:
  API_URL    Your API URL (default: http://localhost:3000)
             Example: https://your-app.railway.app

Environment variables:
  API_URL    Alternative way to set the API URL

Examples:
  node check_markets.js https://your-app.railway.app
  API_URL=https://your-app.railway.app node check_markets.js
`);
  process.exit(0);
}

async function checkCity(location, cityName) {
  try {
    const url = `${API_URL}/api/weather/history?location=${encodeURIComponent(location)}&date=${date}`;
    console.log(`\nChecking ${cityName} (${location})...`);
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.success && data.data) {
      const maxTemp = data.data.daily?.temperature?.max;
      const minTemp = data.data.daily?.temperature?.min;
      const avgTemp = data.data.daily?.temperature?.average;
      
      if (maxTemp !== null && maxTemp !== undefined) {
        console.log(`  ✅ Max Temperature: ${maxTemp}°C`);
        console.log(`  Min Temperature: ${minTemp}°C`);
        console.log(`  Average Temperature: ${avgTemp}°C`);
        
        // Round to whole degrees as per Polymarket rules
        const roundedMax = Math.round(maxTemp);
        console.log(`  📊 Rounded Max (for market): ${roundedMax}°C`);
        
        return {
          city: cityName,
          location,
          maxTemp: roundedMax,
          actualMax: maxTemp,
          minTemp,
          avgTemp,
          success: true
        };
      } else {
        console.log(`  ⚠️  No temperature data available`);
        return { city: cityName, location, success: false, error: 'No data' };
      }
    } else {
      console.log(`  ❌ Error: ${data.error?.message || 'Unknown error'}`);
      return { city: cityName, location, success: false, error: data.error?.message };
    }
  } catch (error) {
    console.log(`  ❌ Request failed: ${error.message}`);
    return { city: cityName, location, success: false, error: error.message };
  }
}

async function analyzeMarkets() {
  console.log(`\n🌡️  Checking temperature markets for December 18, 2025`);
  console.log(`API URL: ${API_URL}\n`);
  
  const results = [];
  
  for (const city of cities) {
    const result = await checkCity(city.location, city.name);
    results.push(result);
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n\n📊 SUMMARY - December 18, 2025 Maximum Temperatures:\n`);
  console.log('─'.repeat(60));
  console.log(`${'City'.padEnd(15)} | ${'Location'.padEnd(25)} | Max Temp (°C)`);
  console.log('─'.repeat(60));
  
  results.forEach(result => {
    if (result.success) {
      console.log(`${result.city.padEnd(15)} | ${result.location.padEnd(25)} | ${result.maxTemp}°C`);
    } else {
      console.log(`${result.city.padEnd(15)} | ${result.location.padEnd(25)} | ${result.error || 'N/A'}`);
    }
  });
  
  console.log('─'.repeat(60));
  
  // Check for potential misvaluations
  console.log(`\n🔍 Market Analysis & Potential Misvaluations:\n`);
  
  // Known market probabilities (from Polymarket)
  const marketData = {
    'London': {
      probabilities: {
        '8': '<1%',
        '9': '<1%',
        '10': '1%',
        '11': '2%',
        '12': '36%',
        '13': '49%',
        '14+': '12%'
      }
    }
  };
  
  results.forEach(result => {
    if (result.success) {
      const market = marketData[result.city];
      const expectedTemp = result.maxTemp.toString();
      const expectedTempKey = expectedTemp >= 14 ? '14+' : expectedTemp;
      
      console.log(`\n📍 ${result.city} (${result.location}):`);
      console.log(`   Actual Max Temp: ${result.actualMax.toFixed(1)}°C`);
      console.log(`   Rounded (market resolution): ${result.maxTemp}°C`);
      
      if (market) {
        const marketProb = market.probabilities[expectedTempKey] || 'Unknown';
        console.log(`   Market probability for ${result.maxTemp}°C: ${marketProb}`);
        
        // Check if market is misvalued
        if (parseFloat(marketProb.replace('%', '')) < 50 && result.maxTemp >= 13) {
          console.log(`   ⚠️  POTENTIAL MISVALUATION: Market shows ${marketProb} for ${result.maxTemp}°C, but this is likely the outcome!`);
        } else if (parseFloat(marketProb.replace('%', '')) > 50 && result.maxTemp < 13) {
          console.log(`   ⚠️  POTENTIAL MISVALUATION: Market favors 13°C (${market.probabilities['13']}), but actual is ${result.maxTemp}°C`);
        } else {
          console.log(`   ✓ Market probability seems reasonable`);
        }
      } else {
        console.log(`   ℹ️  No market data available for comparison`);
      }
    } else {
      console.log(`\n❌ ${result.city}: ${result.error || 'Failed to fetch data'}`);
    }
  });
  
  console.log(`\n\n💡 Note: Markets resolve to whole degrees Celsius.`);
  console.log(`   Compare the rounded max temperature with market probabilities to find misvaluations.\n`);
}

analyzeMarkets().catch(console.error);

