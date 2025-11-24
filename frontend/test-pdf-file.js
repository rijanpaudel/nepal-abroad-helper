const fs = require('fs');
const pdf = require('pdf-parse');

async function test() {
    try {
        console.log('Testing PDF parsing with test.pdf...');
        const dataBuffer = fs.readFileSync('./test.pdf');
        const data = await pdf(dataBuffer);
        console.log('PDF Text:', data.text);
        console.log('PDF parsing successful!');
    } catch (e) {
        console.error('PDF parsing failed:', e.message);
    }
}

test();
