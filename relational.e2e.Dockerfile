FROM node:24.14.1-alpine

RUN apk add --no-cache bash
RUN npm i -g pnpm@12.10.1 @nestjs/cli typescript ts-node

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /tmp/app/
RUN cd /tmp/app && pnpm install --frozen-lockfile

COPY . /usr/src/app
RUN cp -a /tmp/app/node_modules /usr/src/app
COPY ./wait-for-it.sh /opt/wait-for-it.sh
RUN chmod +x /opt/wait-for-it.sh
COPY ./startup.relational.ci.sh /opt/startup.relational.ci.sh
RUN chmod +x /opt/startup.relational.ci.sh
RUN sed -i 's/\r//g' /opt/wait-for-it.sh
RUN sed -i 's/\r//g' /opt/startup.relational.ci.sh

WORKDIR /usr/src/app
RUN echo "" > .env
RUN pnpm run build

CMD ["/opt/startup.relational.ci.sh"]
