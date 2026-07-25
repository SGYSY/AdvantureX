from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    api_key: str = ""
    database_path: str = "./wingman.db"
    default_delay_seconds: int = 8
    user_phone_number: str = ""
    public_base_url: str = "http://127.0.0.1:8000"
    cors_origins: str = ""
    photon_bridge_url: str = ""
    wingman_shared_secret: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    call_audio_url: str = ""
    stepfun_api_key: str = ""
    stepfun_base_url: str = "https://api.stepfun.com/step_plan/v1"
    stepfun_agent_model: str = "step-3.5-flash"
    stepfun_realtime_url: str = "wss://api.stepfun.com/step_plan/v1/realtime"
    stepfun_audio_model: str = "stepaudio-2.5-realtime"
    dimos_mcp_url: str = "http://127.0.0.1:9990/mcp"


@lru_cache
def get_settings() -> Settings:
    return Settings()
