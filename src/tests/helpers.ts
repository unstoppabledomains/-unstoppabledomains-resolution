import nock from 'nock';
import _ from 'lodash';
import {Dictionary} from '../types';
import mockData from './testData/mockData.json';
import ResolutionError, {ResolutionErrorCode} from '../errors/resolutionError';
import ConfigurationError, {
  ConfigurationErrorCode,
} from '../errors/configurationError';
import DnsRecordsError, {DnsRecordsErrorCode} from '../errors/dnsRecordsError';

export const MainnetUrl = 'https://eth-rinkeby.alchemyapi.io';
export const ZilliqaUrl = 'https://api.zilliqa.com';
export const DefaultUrl = 'https://unstoppabledomains.com/api/v1';

export const CryptoDomainWithTwitterVerification =
  'reseller-test-udtesting-052523593694.crypto';
export const CryptoDomainWithUsdtMultiChainRecords =
  'test-usdt-and-dns-records.crypto';
export const ZilDomainWithUsdtMultiChainRecords =
  'reseller-test-udtesting-422508414817.zil';
export const CryptoDomainLayerOneWithNoResolver =
  'udtestdev-test-l1-domain-no-resolver.crypto';
export const CryptoDomainWithAllRecords = 'test-usdt-and-dns-records.crypto';
export const ZilDomainWithAllRecords = 'test-usdt-and-dns-records.zil';
export const ZilDomainWithNoResolver =
  'udtestdev-test-l1-domain-no-resolver.zil';
export const WalletDomainLayerTwoWithAllRecords =
  'udtestdev-test-l2-domain-784391.wallet';
export const WalletDomainLayerTwoWithNoRecords =
  'udtestdev-test-l2-domain-empty.wallet';
export const WalletDomainOnBothLayers =
  'udtestdev-test-l1-and-l2-ownership.wallet';
export const CryptoDomainWithoutGunDbRecords =
  'test-usdt-and-dns-records.crypto';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  dotenv.config();
} catch (err) {
  console.warn('dotenv is not installed');
}

export function mockAsyncMethod(
  object: any,
  method: string,
  value: unknown,
): jest.SpyInstance {
  const spy = jest.spyOn(object, method);
  if (!isLive()) {
    if (value instanceof Function) {
      return spy.mockImplementation(value as any);
    } else if (value instanceof Error) {
      return spy.mockRejectedValue(value);
    } else {
      return spy.mockResolvedValue(value);
    }
  }

  return spy;
}

export function mockAsyncMethods(
  object: any,
  methods: Dictionary<any>,
): jest.SpyInstance[] {
  return Object.entries(methods).map((method) =>
    mockAsyncMethod(object, method[0], method[1]),
  );
}

export function isLive(): boolean {
  return !!process.env.LIVE;
}

export const skipItInLive = isLive() ? it.skip : it;

export function expectSpyToBeCalled(
  spies: jest.SpyInstance[],
  times?: number,
): void {
  if (!isLive()) {
    spies.forEach((spy) => {
      times ? expect(spy).toBeCalledTimes(times) : expect(spy).toBeCalled();
    });
  }
}

export async function expectResolutionErrorCode(
  callback: Promise<any> | Function,
  code: ResolutionErrorCode,
): Promise<void> {
  return expectError(callback, code, ResolutionError);
}

export async function expectConfigurationErrorCode(
  callback: Promise<any> | Function,
  code: ConfigurationErrorCode,
): Promise<void> {
  return expectError(callback, code, ConfigurationError);
}

export async function expectDnsRecordErrorCode(
  callback: Promise<any> | Function,
  code: DnsRecordsErrorCode,
): Promise<void> {
  return expectError(callback, code, DnsRecordsError);
}

type ErrorClass =
  | typeof ResolutionError
  | typeof ConfigurationError
  | typeof DnsRecordsError;

async function expectError(
  callback: Promise<any> | Function,
  code: string,
  klass: ErrorClass,
): Promise<void> {
  if (callback instanceof Function) {
    callback = new Promise((resolve, reject) => {
      const result = (callback as Function)();
      if (result instanceof Promise) {
        result.then(resolve, reject);
      } else {
        resolve(result);
      }
    });
  }

  return callback.then(
    () => {
      throw new Error(`Expected ${klass.name} to be thrown but wasn't`);
    },
    (error) => {
      // Redundant code quality check is required
      // to display stack traces when code is incorrect
      if (error instanceof klass && error.code === code) {
        return expect(error.code).toEqual(code);
      } else {
        throw error;
      }
    },
  );
}

export function mockAPICalls(testName: string, url = MainnetUrl): void {
  if (isLive()) {
    return;
  }

  const mcdt = mockData;
  const mockCall = mcdt[testName];

  mockCall.forEach(({METHOD, REQUEST, RESPONSE}) => {
    switch (METHOD) {
      case 'POST': {
        nock(url)
          .post('', JSON.stringify(REQUEST), undefined)
          .reply(200, JSON.stringify(RESPONSE));
        break;
      }
      default: {
        nock(url)
          .get(REQUEST as string, undefined, undefined)
          .reply(200, RESPONSE);
      }
    }
  });
}

/**
 * returns either a standard ethereum provider url
 * or the one with attached SECRET key from
 * UNSTOPPABLE_RESOLUTION_PROJECTID env variable if any
 */
export function protocolLink(
  providerProtocol: ProviderProtocol = ProviderProtocol.http,
  namingService: 'UNSL1' | 'UNSL2' = 'UNSL1',
): string {
  const secret = process.env.UNSTOPPABLE_RESOLUTION_PROJECTID ?? undefined;

  if (!secret) {
    return ethereumDefaultProviders[namingService][providerProtocol];
  }

  if (namingService === 'UNSL2') {
    return providerProtocol === ProviderProtocol.wss
      ? `wss://eth-rinkeby.alchemyapi.io/v2/${secret}`
      : `https://eth-rinkeby.alchemyapi.io/v2/${secret}`;
  }

  return providerProtocol === ProviderProtocol.wss
    ? `wss://eth-rinkeby.alchemyapi.io/v2/${secret}`
    : `https://eth-rinkeby.alchemyapi.io/v2/${secret}`;
}

export enum ProviderProtocol {
  'http' = 'http',
  'wss' = 'wss',
}

export const caseMock = <T, U>(
  params: T,
  cases: {request: T; response: U}[],
): U => {
  for (const {request, response} of cases) {
    if (_.isEqual(params, request)) {
      return response;
    }
  }

  throw new Error(`got unexpected params ${JSON.stringify(params)}`);
};

const ethereumDefaultProviders = {
  UNSL1: {
    http: 'https://eth-rinkeby.alchemyapi.io/v2/ZDERxOLIj120dh2-Io2Q9RTh9RfWEssT',
    wss: 'wss://eth-rinkeby.alchemyapi.io/v2/ZDERxOLIj120dh2-Io2Q9RTh9RfWEssT',
  },
  UNSL2: {
    http: 'https://polygon-mumbai.g.alchemy.com/v2/c4bb906ed6904c42b19c95825fe55f39',
    wss: 'wss://polygon-mumbai.g.alchemy.com/v2/c4bb906ed6904c42b19c95825fe55f39',
  },
};
