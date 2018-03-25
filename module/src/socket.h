#pragma once

#include <string>
#include <stdlib.h>

#ifdef _WIN32
#include <winsock.h>
#define CLOSE closesocket
#else
#include <unistd.h>
#define CLOSE close
#define SOCKET_ERROR -1
#endif

#define BSOCK_FREE 0
#define BSOCK_BOUND 1
#define BSOCK_CONNECTED 2

namespace BSocket {

#ifdef _WIN32
	void start() {
		WSADATA wsaData;
		if (WSAStartup(0x0002, &wsaData) != 0) {
			fprintf(stderr, "WSAStartup() failed");
		}
	}

	void finish() {
		WSACleanup();
	}
#endif
	
	typedef struct {
		int svSock;
		int clSock;
		struct sockaddr_in svAddr;
		struct sockaddr_in clAddr;
		int clAddrLen;
		unsigned char state;
	} bsocket;

	void freesock(bsocket* sock) {
		if (sock->state == BSOCK_CONNECTED) {
			CLOSE(sock->clSock);
			sock->state = BSOCK_BOUND;
		}
		if (sock->state == BSOCK_BOUND) {
			CLOSE(sock->svSock);
			sock->state = BSOCK_FREE;
		}
	}

	void create(bsocket* sock) {
		sock->state = BSOCK_FREE;
	}

	bool bind(bsocket* sock, const char* host, unsigned short port) {
		if (sock->state != BSOCK_FREE) return false;
		if ((sock->svSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)) == SOCKET_ERROR) {
			fprintf(stderr, "socket() failed");
			perror("wtf");
			return false;
		}
		memset(&sock->svAddr, 0, sizeof(struct sockaddr_in));
		sock->svAddr.sin_family = AF_INET;
		struct hostent* he = gethostbyname(host);
		memcpy(&sock->svAddr.sin_addr, he->h_addr_list[0], he->h_length);
		sock->svAddr.sin_port = htons(port);
		if (bind(sock->svSock, (struct sockaddr *) &sock->svAddr, sizeof(struct sockaddr_in)) == SOCKET_ERROR) {
			fprintf(stderr, "bind() failed");
			perror("wtf");
			CLOSE(sock->svSock);
			return false;
		}
		if (listen(sock->svSock, 1) == SOCKET_ERROR) {
			fprintf(stderr, "listen() failed");
			perror("wtf");
			CLOSE(sock->svSock);
			return false;
		}

		sock->state = BSOCK_BOUND;
		return true;
	}

	bool tryaccept(bsocket* sock) {
		if (sock->state != BSOCK_BOUND) return false;
		fd_set readSet;
		FD_ZERO(&readSet);
		FD_SET(sock->svSock, &readSet);
		timeval timeout;
		timeout.tv_sec = 0;
		timeout.tv_usec = 0;
		if (select(sock->svSock, &readSet, NULL, NULL, &timeout) == 1) {
			int size = sizeof(sock->clAddr);
			if ((sock->clSock = accept(sock->svSock, (struct sockaddr *) &sock->clAddr, &size)) < 0) {
				fprintf(stderr, "accept() failed");
				perror("wtf");
				return false;
			}
			sock->state = BSOCK_CONNECTED;
			return true;
		}
		return false;
	}

	std::string* readstr(bsocket* sock) {
		if (sock->state != BSOCK_CONNECTED) return NULL;
		int len = 0;
		int received = 0, total = 0;
		if (recv(sock->clSock, (char*)&len, sizeof(int), NULL) < 4) {
			CLOSE(sock->clSock);
			sock->state = BSOCK_BOUND;
			return NULL;
		}
		len = ntohl(len);
		char* buffer = (char*) malloc(len);
		while (total < len) {
			if ((received = recv(sock->clSock, buffer + total, len - total, 0)) <= 0)
				break;
			total += received;
		}
		if (total != len) {
			CLOSE(sock->clSock);
			sock->state = BSOCK_BOUND;
			delete buffer;
			return NULL;
		}
		std::string* str = new std::string(buffer, len);
		delete buffer;
		return str;
	}

	std::string* tryreadstr(bsocket* sock) {
		if (sock->state != BSOCK_CONNECTED) return NULL;
		fd_set readSet;
		FD_ZERO(&readSet);
		FD_SET(sock->clSock, &readSet);
		timeval timeout;
		timeout.tv_sec = 0;
		timeout.tv_usec = 0;
		if (select(sock->clSock + 1, &readSet, NULL, NULL, &timeout) == 1) {
			return readstr(sock);
		}
		return NULL;
	}

	void writestr(bsocket* sock, std::string str) {
		if (sock->state != BSOCK_CONNECTED) return;
		unsigned int len = htonl(str.length());
		send(sock->clSock, (const char*) &len, sizeof(unsigned int), NULL);
		send(sock->clSock, str.c_str(), str.length(), NULL);
	}

	void drop(bsocket* sock) {
		if (sock->state != BSOCK_CONNECTED) return;
		CLOSE(sock->clSock);
		sock->state = BSOCK_BOUND;
	}
}