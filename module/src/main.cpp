#include "GarrysMod/Lua/Interface.h"
#include <stdio.h>
#include <sstream>
#include <iomanip>
#include <string>
#include "socket.h"
#include "openssl/sha.h"

#define TYPE_BSOCKET 75

using namespace GarrysMod::Lua;
using namespace BSocket;

LUA_FUNCTION(sock_gc) {
	LUA->CheckType(1, TYPE_BSOCKET);
	bsocket* sock = LUA->GetUserType<bsocket>(1, TYPE_BSOCKET);
	BSocket::freesock(sock);
	LUA->SetUserType(1, NULL);
	delete sock;
	return 0;
}

LUA_FUNCTION(sock_tostring) {
	LUA->CheckType(1, TYPE_BSOCKET);
	bsocket* sock = LUA->GetUserType<bsocket>(1, TYPE_BSOCKET);
	std::ostringstream ss;
	ss << "blocksocket: 0x" << std::hex << ((int) sock);
	LUA->PushString(ss.str().c_str());
	return 1;
}

LUA_FUNCTION(auth_check) {
	LUA->CheckType(1, TYPE_BSOCKET);
	const char* key = LUA->CheckString(2);
	const char* nonce = LUA->CheckString(3);
	const char* hexohash = LUA->CheckString(4);
	if (strlen(hexohash) != 64)
		return 0;
	BYTE ohash[32];
	for (int i = 0; i < 32; i++) {
		char a = hexohash[i * 2], b = hexohash[i * 2 + 1];
		if (((a >= '0' && a <= '9') || (a >= 'A' && a <= 'F')) && ((b >= '0' && b <= '9') || (b >= 'A' && b <= 'F'))) {
			ohash[i] = (a <= '9' ? a - '0' : a - 'A' + 10) << 4 | (b <= '9' ? b - '0' : b - 'A' + 10);
		} else return 0;
	}
	SHA256_CTX st;
	SHA256_Init(&st);
	SHA256_Update(&st, (const BYTE*) key, strlen(key));
	SHA256_Update(&st, (const BYTE*) nonce, strlen(nonce));
	BYTE hash[32];
	SHA256_Final(hash, &st);
	for (int i = 0; i < 32; i++)
		if (hash[i] != ohash[i])
			return 0;
	LUA->PushBool(true);
	return 1;
}

LUA_FUNCTION(sock_bind) {
	LUA->CheckType(1, TYPE_BSOCKET);
	const char* host = LUA->CheckString(2);
	int port = (int) LUA->CheckNumber(3);
	bsocket* sock = LUA->GetUserType<bsocket>(1, TYPE_BSOCKET);
	LUA->PushBool(BSocket::bind(sock, host, port));
	return 1;
}

LUA_FUNCTION(sock_tryaccept) {
	LUA->CheckType(1, TYPE_BSOCKET);
	bsocket* sock = LUA->GetUserType<bsocket>(1, TYPE_BSOCKET);
	LUA->PushBool(BSocket::tryaccept(sock));
	return 1;
}

LUA_FUNCTION(sock_recv) {
	LUA->CheckType(1, TYPE_BSOCKET);
	bsocket* sock = LUA->GetUserType<bsocket>(1, TYPE_BSOCKET);
	std::string* msg = BSocket::readstr(sock);
	if (msg) {
		LUA->PushString(msg->c_str());
		delete msg;
		return 1;
	}
	return 0;
}

LUA_FUNCTION(sock_tryrecv) {
	LUA->CheckType(1, TYPE_BSOCKET);
	bsocket* sock = LUA->GetUserType<bsocket>(1, TYPE_BSOCKET);
	std::string* msg = BSocket::tryreadstr(sock);
	if (msg) {
		LUA->PushString(msg->c_str());
		delete msg;
		return 1;
	}
	return 0;
}

LUA_FUNCTION(sock_send) {
	LUA->CheckType(1, TYPE_BSOCKET);
	const char* msg = LUA->CheckString(2);
	bsocket* sock = LUA->GetUserType<bsocket>(1, TYPE_BSOCKET);
	BSocket::writestr(sock, std::string(msg));
	return 0;
}

LUA_FUNCTION(sock_drop) {
	LUA->CheckType(1, TYPE_BSOCKET);
	bsocket* sock = LUA->GetUserType<bsocket>(1, TYPE_BSOCKET);
	BSocket::drop(sock);
	return 0;
}

LUA_FUNCTION(sock_close) {
	LUA->CheckType(1, TYPE_BSOCKET);
	bsocket* sock = LUA->GetUserType<bsocket>(1, TYPE_BSOCKET);
	BSocket::freesock(sock);
	return 0;
}

LUA_FUNCTION(sock_getstate) {
	LUA->CheckType(1, TYPE_BSOCKET);
	bsocket* sock = LUA->GetUserType<bsocket>(1, TYPE_BSOCKET);
	switch (sock->state) {
		case BSOCK_FREE:
			LUA->PushString("Free");
			break;
		case BSOCK_BOUND:
			LUA->PushString("Bound");
			break;
		case BSOCK_CONNECTED:
			LUA->PushString("Connected");
			break;
		default:
			LUA->PushNil();
	}
	return 1;
}

int sockmeta;

LUA_FUNCTION(sock_new) {
	bsocket* sock = new bsocket;
	BSocket::create(sock);
	LUA->PushUserType(sock, TYPE_BSOCKET);
	LUA->ReferencePush(sockmeta);
	LUA->SetMetaTable(-2);
	return 1;
}

GMOD_MODULE_OPEN() {

#ifdef _WIN32
	BSocket::start();
#endif

	LUA->CreateTable();//+1
	{
		LUA->Push(-1);//+1
		LUA->SetField(-2, "__index");//-1, ref 2

		LUA->PushCFunction(sock_gc);//+1
		LUA->SetField(-2, "__gc");//-1, ref 2

		LUA->PushCFunction(sock_tostring);//+1
		LUA->SetField(-2, "__tostring");//-1, ref 2

		LUA->PushString("blocksocket");//+1
		LUA->SetField(-2, "MetaName");//-1, ref 2

		LUA->PushCFunction(auth_check);//+1
		LUA->SetField(-2, "CheckAuth");//-1, ref 2

		LUA->PushCFunction(sock_bind);//+1
		LUA->SetField(-2, "Bind");//-1, ref 2

		LUA->PushCFunction(sock_tryaccept);//+1
		LUA->SetField(-2, "TryAccept");//-1, ref 2

		LUA->PushCFunction(sock_recv);//+1
		LUA->SetField(-2, "ReadString");//-1, ref 2

		LUA->PushCFunction(sock_tryrecv);//+1
		LUA->SetField(-2, "TryReadString");//-1, ref 2

		LUA->PushCFunction(sock_send);//+1
		LUA->SetField(-2, "WriteString");//-1, ref 2

		LUA->PushCFunction(sock_drop);//+1
		LUA->SetField(-2, "Drop");//-1, ref 2

		LUA->PushCFunction(sock_close);//+1
		LUA->SetField(-2, "Close");//-1, ref 2

		LUA->PushCFunction(sock_getstate);//+1
		LUA->SetField(-2, "GetState");//-1, ref 2
	}
	sockmeta = LUA->ReferenceCreate();//-1

	LUA->PushSpecial(GarrysMod::Lua::SPECIAL_GLOB); //+1
	LUA->PushString("blocksocket"); //+1
	LUA->PushCFunction(sock_new);//+1
	LUA->SetTable(-3); //-3

	return 0;
}

GMOD_MODULE_CLOSE() {
#ifdef _WIN32
	BSocket::finish();
#endif
	return 0;
}