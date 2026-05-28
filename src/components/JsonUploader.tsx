import React from 'react';

// Define the props to accept a function from the parent
interface JsonUploaderProps {
  onJsonLoaded: (data: any) => void;
}

export default function JsonUploader({ onJsonLoaded }: JsonUploaderProps) {
  
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    
    // When the file finishes reading
    reader.onloadend = () => {
      try {
        // Try to parse the text into JSON
        const parsedJson = JSON.parse(reader.result as string);
        
        // Pass the successfully parsed JSON back up to the parent
        onJsonLoaded(parsedJson);
        
      } catch (error) {
        console.error("File is not valid JSON", error);
        alert("Invalid JSON file");
      }
    };

    // Start reading the file as text
    reader.readAsText(file);
  };

  return (
    <div style={{ padding: '20px', background: '#f5f5f5', marginBottom: '20px' }}>
      <h3>Upload KB JSON</h3>
      {/* The accept attribute restricts the file picker to .json files */}
      <input type="file" accept=".json" onChange={handleFileUpload} />
    </div>
  );
}