# Sample Files

This directory contains sample files for testing the AI Input Configuration Generator.

## Files

### sample.json
Sample insurance product JSON structure containing:
- Product code
- Basic details (proposer and insured information)
- Coverage details
- Additional benefits

### sample-metadata.xlsx
Excel mapping sheet with field metadata.

## Usage

1. Open http://localhost:3000
2. Select "Generator" tab
3. Upload `sample.json` as JSON file
4. Upload `sample-metadata.xlsx` as Excel file
5. Click "Generate"
6. Download the generated Excel output

## Creating Custom Files

### JSON File
Structure your API data as nested objects. The system flattens it automatically.

```json
{
  "productCode": "TERM01",
  "basicDetails": {
    "insured": {
      "gender": "male",
      "dateOfBirth": "1990-01-01"
    }
  }
}
```

### Excel Mapping Sheet
The system handles varied formats from different insurers. Common columns include:
- Field name/identifier
- Label/caption
- Data type
- Required/mandatory flag
- List values (for dropdowns)
- Min/max values
- Regex patterns

The AI analyzes the sheet structure automatically - no fixed format required.

## Output Format

Generated Excel contains 33 standardized columns. See main README for full column list.
