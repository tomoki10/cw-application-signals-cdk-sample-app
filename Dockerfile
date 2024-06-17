# MEMO: aws-opentelemetry-distro not work 3.9-slim-buster, 3.9-slim
FROM python:3.9

WORKDIR /code

COPY ./app/requirements.txt /code/requirements.txt

RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# See: https://github.dev/aws-observability/application-signals-demo/tree/main/pet_clinic_insurance_service/service
RUN pip install aws-opentelemetry-distro

COPY ./app /code/app

CMD ["opentelemetry-instrument", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]