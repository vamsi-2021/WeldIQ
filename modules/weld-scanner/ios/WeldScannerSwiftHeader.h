// Imports the Swift-generated header for this pod. Its path differs between
// static-library and framework builds, so try both.
#if __has_include(<WeldScanner/WeldScanner-Swift.h>)
#import <WeldScanner/WeldScanner-Swift.h>
#else
#import "WeldScanner-Swift.h"
#endif
