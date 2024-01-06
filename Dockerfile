FROM node:20
USER root

COPY ./* /root/

ENV SHELL=/bin/bash

RUN npm install

ENTRYPOINT ["npm start"]
