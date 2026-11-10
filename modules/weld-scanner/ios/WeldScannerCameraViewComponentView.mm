// Fabric component that hosts the scanner's camera preview.
// Mounting attaches the single shared camera session; unmounting releases it.

#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

#import <react/renderer/components/WeldScannerSpec/ComponentDescriptors.h>
#import <react/renderer/components/WeldScannerSpec/Props.h>
#import <react/renderer/components/WeldScannerSpec/RCTComponentViewHelpers.h>

#import "WeldScannerSwiftHeader.h"

using namespace facebook::react;

@interface WeldScannerCameraViewComponentView : RCTViewComponentView
@end

@implementation WeldScannerCameraViewComponentView {
  UIView *_container;
  BOOL _attached;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<WeldScannerCameraViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const WeldScannerCameraViewProps>();
    _props = defaultProps;
    _container = [[UIView alloc] initWithFrame:self.bounds];
    _container.backgroundColor = UIColor.blackColor;
    _container.clipsToBounds = YES;
    self.contentView = _container;
  }
  return self;
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.window != nil && !_attached) {
    _attached = YES;
    [WeldScannerCore.shared attachPreview:_container];
  } else if (self.window == nil && _attached) {
    [self detach];
  }
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  for (UIView *subview in _container.subviews) {
    subview.frame = _container.bounds;
  }
  [WeldScannerCore.shared layoutPreview];
}

- (void)prepareForRecycle
{
  [self detach];
  [super prepareForRecycle];
}

- (void)detach
{
  if (_attached) {
    _attached = NO;
    [WeldScannerCore.shared detachPreview:_container];
  }
}

@end
