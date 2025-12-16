# 🌤️ Wunderground Weather History Scraper API

A RESTful API to scrape historical weather data from Wunderground, extracting temperature, precipitation, and wind speed data for any location and date.

## ✨ Features

- **Historical Weather Data**: Fetch weather data for any past date
- **Multiple Metrics**: Temperature, precipitation, wind speed, humidity
- **Date Range Support**: Query multiple days at once
- **Smart Caching**: In-memory cache with 1-hour TTL
- **Rate Limiting**: Built-in protection (10 requests/minute)
- **Comprehensive Validation**: Input validation with helpful error messages
- **Docker Ready**: Easy deployment with included Dockerfile

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
cd wundergroundAPI

# Install dependencies
npm install

# Start the server
npm start

# Or for development with auto-reload
npm run dev
```

The API will be available at `http://localhost:3000`

### Docker Deployment

```bash
# Build the image
docker build -t wunderground-api .

# Run the container
docker run -p 3000:3000 wunderground-api
```

## 📖 API Endpoints

### Get Historical Weather Data

```http
GET /api/weather/history?location={location}&date={date}&metric={metric}
```

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `location` | string | Yes | Station code in format: country/city/station_code | `kr/incheon/RKSI` |
| `date` | string | Yes | Date in YYYY-MM-DD format | `2025-12-16` |
| `metric` | string | No | Specific metric: `temperature`, `precipitation`, `wind` | `temperature` |

**Example Request:**
```bash
curl "http://localhost:3000/api/weather/history?location=kr/incheon/RKSI&date=2025-12-16"
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "location": {
      "city": "Incheon",
      "country": "South Korea",
      "station": "RKSI"
    },
    "date": "2025-12-16",
    "current": {
      "temperature": {
        "celsius": 5.0,
        "fahrenheit": 41.0
      },
      "precipitation": {
        "mm": 0,
        "inches": 0
      },
      "wind": {
        "speed_kmh": 11,
        "speed_mph": 6.8
      }
    },
    "daily": {
      "temperature": {
        "min": 4.0,
        "max": 7.0,
        "average": 5.2
      },
      "precipitation_total": 0,
      "data_points": 24
    },
    "hourly_data": [...]
  },
  "metadata": {
    "scraped_at": "2025-12-16T15:30:00Z",
    "source": "wunderground.com",
    "cache_hit": false
  }
}
```

### Get Latest Weather Data

```http
GET /api/weather/latest?location={location}
```

Returns only the current/latest weather conditions.

```bash
curl "http://localhost:3000/api/weather/latest?location=us/new-york/KJFK"
```

### Get Weather Data Range

```http
GET /api/weather/range?location={location}&start_date={start}&end_date={end}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `location` | string | Yes | Station code |
| `start_date` | string | Yes | Start date (YYYY-MM-DD) |
| `end_date` | string | Yes | End date (YYYY-MM-DD) |
| `metric` | string | No | Specific metric to fetch |

**Note:** Maximum date range is 30 days.

```bash
curl "http://localhost:3000/api/weather/range?location=kr/incheon/RKSI&start_date=2025-12-01&end_date=2025-12-05"
```

### Cache Management

```http
# Get cache statistics
GET /api/weather/cache/stats

# Clear cache
DELETE /api/weather/cache
```

### Health Check

```http
GET /health
```

Returns server health status, uptime, and cache statistics.

## 🗺️ Finding Location Codes

Location codes follow the pattern: `{country}/{city}/{station_code}`

To find a station code:
1. Go to [wunderground.com](https://www.wunderground.com)
2. Search for your location
3. Navigate to the history page
4. The URL will contain the location code: `https://www.wunderground.com/history/daily/kr/incheon/RKSI/date/2025-12-16`

### Common Station Codes

| Location | Code |
|----------|------|
| Incheon, South Korea | `kr/incheon/RKSI` |
| New York JFK, USA | `us/new-york/KJFK` |
| London Heathrow, UK | `gb/london/EGLL` |
| Tokyo Narita, Japan | `jp/tokyo/RJAA` |
| Sydney, Australia | `au/sydney/YSSY` |

## ⚙️ Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `RATE_LIMIT` | `10` | Max requests per minute |
| `CORS_ORIGIN` | `*` | CORS allowed origins |
| `NODE_ENV` | `development` | Environment mode |

## 🛠️ Development

```bash
# Run in development mode with auto-reload
npm run dev

# Run tests
npm test
```

## 📁 Project Structure

```
wundergroundAPI/
├── src/
│   ├── index.js              # Main server entry point
│   ├── routes/
│   │   └── weather.js        # Weather API routes
│   ├── services/
│   │   ├── scraper.js        # Puppeteer scraping logic
│   │   └── cache.js          # In-memory cache service
│   ├── middleware/
│   │   └── errorHandler.js   # Error handling middleware
│   └── utils/
│       ├── logger.js         # Winston logger configuration
│       └── validators.js     # Zod validation schemas
├── Dockerfile
├── package.json
└── README.md
```

## ⚠️ Important Notes

1. **Rate Limiting**: The API enforces a rate limit of 10 requests per minute to be respectful to Wunderground's servers.

2. **Caching**: Responses are cached for 1 hour to reduce load on the source website.

3. **Legal Considerations**: This scraper is for educational purposes. Please review Wunderground's Terms of Service before using in production.

4. **Data Accuracy**: Scraped data may vary in availability depending on the weather station and date.

## 📝 License

MIT License - feel free to use this project for your own purposes.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

