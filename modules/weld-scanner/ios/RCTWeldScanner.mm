// TurboModule glue: forwards JS calls to the Swift WeldScannerCore and
// forwards scanner status updates to JS as `onScanUpdate` events.

#import <Foundation/Foundation.h>
#import <WeldScannerSpec/WeldScannerSpec.h>

#import "WeldScannerSwiftHeader.h"

@interface RCTWeldScanner : NativeWeldScannerSpecBase <NativeWeldScannerSpec>
@end

@implementation RCTWeldScanner

+ (NSString *)moduleName
{
  return @"WeldScanner";
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeWeldScannerSpecJSI>(params);
}

// Only start forwarding events once the JS emitter is wired up.
- (void)setEventEmitterCallback:(EventEmitterCallbackWrapper *)eventEmitterCallbackWrapper
{
  [super setEventEmitterCallback:eventEmitterCallbackWrapper];
  __weak RCTWeldScanner *weakSelf = self;
  WeldScannerCore.shared.eventHandler = ^(NSDictionary *status) {
    [weakSelf emitOnScanUpdate:status];
  };
}

- (void)invalidate
{
  WeldScannerCore.shared.eventHandler = nil;
}

- (NSDictionary *)getCapabilities
{
  return [WeldScannerCore.shared capabilities];
}

- (void)startScan:(NSDictionary *)options resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [WeldScannerCore.shared startScan:options
      resolve:^(NSDictionary *info) {
        resolve(info);
      }
      reject:^(NSString *code, NSString *message) {
        reject(code, message, nil);
      }];
}

- (void)pauseScan
{
  [WeldScannerCore.shared pauseScan];
}

- (void)resumeScan
{
  [WeldScannerCore.shared resumeScan];
}

- (void)resetScan
{
  [WeldScannerCore.shared resetScan];
}

- (void)captureManual:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [WeldScannerCore.shared
      captureManualWithResolve:^{
        resolve(nil);
      }
      reject:^(NSString *code, NSString *message) {
        reject(code, message, nil);
      }];
}

- (void)finishScan:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [WeldScannerCore.shared
      finishScanWithResolve:^(NSDictionary *result) {
        resolve(result);
      }
      reject:^(NSString *code, NSString *message) {
        reject(code, message, nil);
      }];
}

- (void)discardScan:(NSString *)scanId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [WeldScannerCore.shared discardScan:scanId
      resolve:^{
        resolve(nil);
      }
      reject:^(NSString *code, NSString *message) {
        reject(code, message, nil);
      }];
}

- (void)zipScan:(NSString *)scanId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [WeldScannerCore.shared zipScan:scanId
      resolve:^(NSDictionary *info) {
        resolve(info);
      }
      reject:^(NSString *code, NSString *message) {
        reject(code, message, nil);
      }];
}

@end
