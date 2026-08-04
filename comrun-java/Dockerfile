# eclipse-temurin provides the JDK; Node is layered on top to run server.js.
FROM eclipse-temurin:25-jdk-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# JUnit4 + Hamcrest, used for the "unittest" directive's classpath.
RUN mkdir -p lib/jars \
  && curl -LOs https://repo1.maven.org/maven2/junit/junit/4.13.2/junit-4.13.2.jar \
  && curl -LOs https://repo1.maven.org/maven2/org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar \
  && mv junit-4.13.2.jar hamcrest-core-1.3.jar lib/jars/

COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js .
COPY lib/*.js lib/

EXPOSE 8080
CMD ["node", "server.js"]
