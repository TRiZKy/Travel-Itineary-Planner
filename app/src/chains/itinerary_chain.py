from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from src.config.config import GROQ_API_KEY

llm = ChatGroq(
    api_key=GROQ_API_KEY,
    model = "llama-3.3-70b-versatile",
    temperature=0.9
)
itinerary_prompt = ChatPromptTemplate([
    ("system" , "You are a helpful travel asssistant. Create a day trip itineary for {city} based on user's interest : {interests}. Provide a brief , bulleted itineary"),
    ("human" , "Create a itineary for my day trip")
])


def generate_itinerary(city: str, interests: list[str]) -> str:
    """
    Generate a day-trip itinerary. Validates inputs, handles API errors,
    and extracts text from various possible response shapes.
    """
    if not city or not city.strip():
        raise ValueError("city must be a non-empty string")

    interests_list = interests or []
    if not interests_list:
        interests_list = ["general sightseeing"]

    prompt_messages = itinerary_prompt.format_messages(
        city=city.strip(),
        interests=", ".join(i.strip() for i in interests_list if i and i.strip())
    )

    try:
        response = llm.invoke(prompt_messages)
    except Exception as e:
        return f"Error generating itinerary: {e}"

    # robust extraction of text
    text = None
    # common attribute
    if hasattr(response, "content") and isinstance(response.content, str):
        text = response.content
    # some SDKs return `.text` or `.message`
    elif hasattr(response, "text") and isinstance(response.text, str):
        text = response.text
    elif hasattr(response, "message") and isinstance(response.message, str):
        text = response.message
    # dict-like responses
    elif isinstance(response, dict):
        for key in ("content", "text", "message", "output"):
            val = response.get(key)
            if isinstance(val, str):
                text = val
                break
    # fallback to string representation
    if text is None:
        try:
            text = str(response)
        except Exception:
            text = ""

    return text.strip()
