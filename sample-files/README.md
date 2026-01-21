# Sample Files

This directory contains sample files to help you test the AI Input Field Generator.

## Files Included

### 1. sample.json
A sample insurance product JSON structure containing:
- Product code
- Basic details (proposer and insured information)
- Coverage details
- Additional benefits

### 2. sample-metadata.xlsx
Excel file containing field metadata with columns:
- `fieldName`: Field path in dot notation
- `label`: Human-readable label
- `dataType`: Input field type (text, number, date, select, boolean)
- `required`: Whether the field is mandatory
- `options`: Comma-separated values for select fields
- `validation`: Validation rules description

## How to Use

1. Open the application (http://localhost:3000)
2. Upload `sample.json` as the JSON file
3. Upload `sample-metadata.xlsx` as the Excel file
4. Click "Generate Input Fields"
5. See the AI-generated form fields!

## Creating Your Own Files

### JSON File
Structure your data as nested objects. The AI will flatten it automatically.

Example:
```json
{
  "field1": "value1",
  "nested": {
    "field2": "value2"
  }
}
```

### Excel Metadata File
Create an Excel file with these columns (in this order):
1. fieldName
2. label
3. dataType
4. required
5. options
6. validation

**Supported dataType values:**
- `text` - Text input
- `number` - Numeric input
- `date` - Date picker
- `select` or `dropdown` - Select dropdown
- `boolean` or `checkbox` - Checkbox
- `textarea` - Multi-line text

**Tips:**
- Use dot notation for nested fields (e.g., `basicDetails.insured.gender`)
- For select fields, separate options with commas
- Mark required as `true` or `false`
