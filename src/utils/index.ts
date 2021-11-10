import {CryptoRecords, NamingServiceName} from '../types/publicTypes';
import {NullAddresses} from '../types';

export function signedInfuraLink(infura: string, network = 'mainnet'): string {
  return `https://${network}.infura.io/v3/${infura}`;
}

export function hexToBytes(hexString: string): number[] {
  const hex = hexString.replace(/^0x/i, '');
  const bytes: number[] = [];
  for (let c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substr(c, 2), 16));
  }

  return bytes;
}

export function isNullAddress(
  key: string | null | undefined,
): key is undefined | null {
  if (!key) {
    return true;
  }
  return Object.values(NullAddresses).includes(key);
}

export function constructRecords(
  keys: string[],
  values: undefined | (string | undefined)[] | CryptoRecords,
): CryptoRecords {
  const records: CryptoRecords = {};
  keys.forEach((key, index) => {
    records[key] =
      (values instanceof Array ? values[index] : values?.[key]) || '';
  });
  return records;
}

export const domainExtensionToNamingServiceName = {
  crypto: NamingServiceName.UNS,
  zil: NamingServiceName.ZNS,
  eth: NamingServiceName.ENS,
  luxe: NamingServiceName.ENS,
  xyz: NamingServiceName.ENS,
  kred: NamingServiceName.ENS,
  reverse: NamingServiceName.ENS,
};

export const findNamingServiceName = (
  domain: string,
): NamingServiceName | '' => {
  const extension = domain.split('.').pop();

  if (!extension) {
    return '';
  } else if (extension in domainExtensionToNamingServiceName) {
    return domainExtensionToNamingServiceName[extension];
  } else {
    return domainExtensionToNamingServiceName.crypto;
  }
};

export const EthereumNetworks = {
  mainnet: 1,
  ropsten: 3,
  rinkeby: 4,
  goerli: 5,
  'polygon-mainnet': 137,
  'polygon-mumbai': 80001,
} as const;

export const EthereumNetworksInverted = {
  1: 'mainnet',
  3: 'ropsten',
  4: 'rinkeby',
  5: 'goerli',
  137: 'polygon-mainnet',
  80001: 'polygon-mumbai',
} as const;
