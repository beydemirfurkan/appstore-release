import CoreLocation

final class StoreLocator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()

    func start() {
        manager.delegate = self
        manager.requestWhenInUseAuthorization()
    }
}
