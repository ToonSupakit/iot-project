#ifndef AIRWATCH_CONNECTION_CONFIG_H
#define AIRWATCH_CONNECTION_CONFIG_H
#include <cstring>
#include <cstdio>
#include <cctype>
// A connection code is AUTO|key (trusted LAN) or https://host[:port]/api/log|key.
inline bool parseConnectionCode(const char* code, char* url, size_t urlSize, char* key, size_t keySize, bool& automatic) {
  if (!code) return false;
  const char* split = std::strchr(code, '|');
  if (!split || std::strchr(split + 1, '|')) return false;
  size_t addressLength = split - code, keyLength = std::strlen(split + 1);
  if (addressLength >= urlSize || keyLength < 16 || keyLength > 64 || keyLength >= keySize) return false;
  for (const char* p=split+1;*p;++p) if(*p<'!'||*p>'~') return false;
  bool isAuto = addressLength == 4 && std::strncmp(code,"AUTO",4)==0;
  if (!isAuto) {
    if (addressLength < 17 || std::strncmp(code,"https://",8)!=0) return false;
    const char* slash=std::strchr(code+8,'/');
    if (!slash || slash>=split || split-slash!=8 || std::strncmp(slash,"/api/log",8)!=0 || slash==code+8) return false;
    for(const char* p=code+8;p<slash;++p) if(!std::isalnum(static_cast<unsigned char>(*p))&&*p!='.'&&*p!='-'&&*p!=':')return false;
    const char* colon=static_cast<const char*>(std::memchr(code+8,':',slash-(code+8)));
    if(colon){unsigned port=0;if(colon==code+8||colon+1==slash)return false;for(const char* p=colon+1;p<slash;++p){if(*p<'0'||*p>'9')return false;port=port*10+(*p-'0');if(port>65535)return false;}if(!port)return false;}
  }
  std::memcpy(url,code,addressLength);url[addressLength]='\0';
  std::memcpy(key,split+1,keyLength+1);automatic=isAuto;return true;
}
#endif
