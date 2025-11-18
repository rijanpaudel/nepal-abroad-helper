import os
import time
from openai import OpenAI
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize clients
openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
supabase_url = os.getenv('SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_KEY')
supabase: Client = create_client(supabase_url, supabase_key)

def generate_embedding(text: str) -> list[float]:
    """
    Generate embedding vector for given text using OpenAI.
    
    Args:
        text: Input text to embed
        
    Returns:
        1536-dimensional embedding vector
    """
    try:
        response = openai_client.embeddings.create(
            model="text-embedding-3-small",  # Cost-effective, 1536 dimensions
            input=text,
            encoding_format="float"
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding: {e}")
        return None

def create_resource_content(resource: dict) -> str:
    """
    Combine resource fields into searchable text.
    
    Strategy: Include all relevant information for semantic search.
    More context = better retrieval accuracy.
    """
    parts = []
    
    # Core information
    parts.append(f"Title: {resource['title']}")
    
    if resource.get('description'):
        parts.append(f"Description: {resource['description']}")
    
    # Category and type
    parts.append(f"Category: {resource['category']}")
    
    if resource.get('institution'):
        parts.append(f"Institution: {resource['institution']}")
    
    # Scholarship-specific fields
    if resource.get('amount'):
        parts.append(f"Amount: {resource['amount']}")
    
    if resource.get('eligibility'):
        parts.append(f"Eligibility: {resource['eligibility']}")
    
    # Metadata fields
    if resource.get('metadata'):
        metadata = resource['metadata']
        if metadata.get('level'):
            parts.append(f"Academic Level: {metadata['level']}")
        if metadata.get('popular_programs'):
            programs = ', '.join(metadata['popular_programs'])
            parts.append(f"Popular Programs: {programs}")
        if metadata.get('location'):
            parts.append(f"Location: {metadata['location']}")
    
    # Tags
    if resource.get('tags'):
        tags = ', '.join(resource['tags'])
        parts.append(f"Tags: {tags}")
    
    return '\n'.join(parts)

def process_all_resources():
    """
    Fetch all resources and generate embeddings.
    """
    print("🚀 Starting embedding generation...\n")
    
    # Fetch all resources from Supabase
    response = supabase.table('resources').select('*').execute()
    resources = response.data
    
    print(f"📚 Found {len(resources)} resources\n")
    
    successful = 0
    failed = 0
    
    for idx, resource in enumerate(resources, 1):
        try:
            resource_id = resource['id']
            title = resource['title']
            
            print(f"[{idx}/{len(resources)}] Processing: {title}")
            
            # Check if embedding already exists
            existing = supabase.table('resource_embeddings')\
                .select('id')\
                .eq('resource_id', resource_id)\
                .execute()
            
            if existing.data:
                print(f"  ✓ Embedding already exists, skipping")
                successful += 1
                continue
            
            # Create searchable content
            content = create_resource_content(resource)
            
            # Generate embedding
            embedding = generate_embedding(content)
            
            if not embedding:
                print(f"  ✗ Failed to generate embedding")
                failed += 1
                continue
            
            # Store in Supabase
            supabase.table('resource_embeddings').insert({
                'resource_id': resource_id,
                'content': content,
                'embedding': embedding
            }).execute()
            
            print(f"  ✓ Embedding generated and stored")
            successful += 1
            
            # Rate limiting: OpenAI allows 3000 requests/min for tier 1
            # Add small delay to be safe
            time.sleep(0.05)
            
        except Exception as e:
            print(f"  ✗ Error: {e}")
            failed += 1
    
    print(f"\n" + "="*60)
    print(f"✅ Completed!")
    print(f"   Successful: {successful}")
    print(f"   Failed: {failed}")
    print(f"   Total: {len(resources)}")
    print("="*60)

def test_search(query: str):
    """
    Test the similarity search with a sample query.
    """
    print(f"\n🔍 Testing search: '{query}'")
    
    # Generate query embedding
    query_embedding = generate_embedding(query)
    
    if not query_embedding:
        print("Failed to generate query embedding")
        return
    
    # Call the match_resources function
    response = supabase.rpc('match_resources', {
        'query_embedding': query_embedding,
        'match_threshold': 0.3,  # Lower threshold for testing
        'match_count': 5
    }).execute()
    
    results = response.data
    
    print(f"\nFound {len(results)} matches:\n")
    
    for idx, result in enumerate(results, 1):
        print(f"{idx}. {result['title']}")
        print(f"   Category: {result['category']}")
        print(f"   Similarity: {result['similarity']:.3f}")
        print(f"   Institution: {result.get('institution', 'N/A')}")
        print()

if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == 'test':
        # Test mode: search with query
        query = ' '.join(sys.argv[2:]) if len(sys.argv) > 2 else "PhD scholarships in Computer Science"
        test_search(query)
    else:
        # Generate embeddings for all resources
        process_all_resources()