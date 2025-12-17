# Polymarket Temperature Market Analysis

## Overview
This script checks December 18, 2025 temperature data for cities that have Polymarket prediction markets, helping identify misvalued markets.

## How to Run

### Option 1: With Railway URL as argument
```bash
node check_markets.js https://your-app.railway.app
```

### Option 2: With environment variable
```bash
API_URL=https://your-app.railway.app node check_markets.js
```

### Option 3: Local development
```bash
# Start your server first
npm start

# Then run in another terminal
node check_markets.js
```

## What It Does

1. Fetches December 18, 2025 weather data for:
   - London (EGLC)
   - New York (KLGA)
   - Seattle (KSEA)
   - Dallas (KDAL)
   - Atlanta (KATL)
   - Toronto (CYYZ)
   - Seoul (RKSI)

2. Extracts the maximum temperature for each city
3. Rounds to whole degrees (as per Polymarket rules)
4. Compares with known market probabilities
5. Identifies potential misvaluations

## Understanding the Results

- **Actual Max Temp**: The precise maximum temperature from weather data
- **Rounded (market resolution)**: The whole degree value the market will resolve to
- **Market probability**: Current market probability for that temperature
- **Misvaluation warnings**: Alerts when market probabilities don't match likely outcomes

## Example Output

```
📍 London (gb/london/EGLC):
   Actual Max Temp: 12.8°C
   Rounded (market resolution): 13°C
   Market probability for 13°C: 49%
   ⚠️  POTENTIAL MISVALUATION: Market shows 49% for 13°C, but this is likely the outcome!
```

## Notes

- Markets resolve to whole degrees Celsius
- Data must be finalized for the date (December 18, 2025)
- The script includes delays to respect rate limits
- Add more cities to the `cities` array if needed

