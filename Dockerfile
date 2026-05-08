FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json .
COPY src/ src/
RUN bun build --compile --minify src/server.js --outfile /server

FROM alpine:3
RUN apk add --no-cache libstdc++ libgcc
COPY --from=builder /server /server
COPY model-tree.json /app/model-tree.json
CMD ["/server"]
