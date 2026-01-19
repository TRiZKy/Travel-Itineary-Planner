from langchain_core.messages import HumanMessage, AIMessage
from src.chains.itinerary_chain import generate_itinerary
from src.utils.logger import get_logger
from src.utils.custom_exception import CustomException

logger = get_logger(__name__)


class TravelPlanner:
    def __init__(self):
        self.messages = []
        self.city = ""
        self.interests = []
        self.itinerary = ""

        logger.info("TravelPlanner initialized.")

    def set_city(self, city: str):
        try:
            self.city = city
            self.messages.append(HumanMessage(content=city))
            logger.info(f"City set to: {city}")
        except Exception as e:
            logger.error(f"Error setting city: {e}")
            raise CustomException("Failed to set city", e)

    def set_interests(self, interests: str):
        try:
            self.interests = [interest.strip() for interest in interests.split(",") if interest.strip()]
            self.messages.append(HumanMessage(content=interests))
            logger.info(f"Interests set to: {self.interests}")
        except Exception as e:
            logger.error(f"Error setting interests: {e}")
            raise CustomException("Failed to set interests", e)

    def create_itinerary(self) -> str:
        try:
            logger.info(f"Creating itinerary for {self.city} and interests {self.interests}")
            self.itinerary = generate_itinerary(self.city, self.interests)
            self.messages.append(AIMessage(content=self.itinerary))
            logger.info("Itinerary created successfully.")
            return self.itinerary
        except Exception as e:
            logger.error(f"Error creating itinerary: {e}")
            raise CustomException("Failed to create itinerary", e)

