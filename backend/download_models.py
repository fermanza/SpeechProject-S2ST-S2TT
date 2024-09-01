# download_models.py
from transformers import MarianMTModel, MarianTokenizer
import logging
import os
import time

logging.basicConfig(level=logging.INFO)


def try_download_model(model_name: str, retries: int = 3, delay: int = 5) -> bool:
    """Try to download the model and tokenizer with retries."""
    model_dir = model_name.replace('/', '_')  # Replace '/' to avoid directory issues

    for attempt in range(retries):
        try:
            # Remove existing directory if it exists
            if os.path.exists(model_dir):
                shutil.rmtree(model_dir)

            # Download and save the model
            logging.info(f"Attempting to download model: {model_name}")
            model = MarianMTModel.from_pretrained(model_name, ignore_mismatched_sizes=True)
            model.save_pretrained(model_dir)

            # Download and save the tokenizer
            tokenizer = MarianTokenizer.from_pretrained(model_name)
            tokenizer.save_pretrained(model_dir)

            logging.info(f"Model {model_name} downloaded successfully.")
            return True
        except Exception as e:
            logging.error(f"Failed to download model {model_name}: {e}")
            if attempt < retries - 1:
                logging.info(f"Retrying... ({attempt + 1}/{retries}) after {delay} seconds delay")
                time.sleep(delay)
    return False


def download_models():
    primary_model = 'facebook/mbart-large-50-many-to-one-mmt'
    fallback_model = 'Helsinki-NLP/opus-mt-en-de'  # Example fallback model

    if try_download_model(primary_model):
        logging.info(f"Primary model {primary_model} was downloaded successfully.")
    else:
        logging.warning(f"Primary model {primary_model} failed, trying fallback model {fallback_model}.")
        if not try_download_model(fallback_model):
            raise EnvironmentError(f"Both primary and fallback models failed to download.")


if __name__ == "__main__":
    download_models()